/**
 * Encrypts personal fields that are still plain text, re-encrypts any value under a key
 * other than the current one, and fills the blind indexes. Safe to run again at any time;
 * it only touches what needs it.
 *
 *   npm run fields:encrypt                       after the security migration, after seeding,
 *                                                and after adding a new key (rotation)
 *   npm run fields:encrypt -- --check            report only; exits 1 if anything needs work
 *
 * Rotation: add the new key at the end of FIELD_ENCRYPTION_KEYS (v1:…,v2:…), restart the
 * API so new values use it, run this, then remove the old key once it reports nothing left.
 * Writes go straight to SQL, around the API's encryption middleware, one row at a time.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { BLIND_INDEXES, ENCRYPTED_FIELDS, FieldCrypto } from '../src/common/crypto/field-crypto';

try { process.loadEnvFile('.env'); } catch { /* the environment is set some other way */ }

const check = process.argv.includes('--check');
const fc = FieldCrypto.fromEnv();
if (!fc) {
  console.error('FIELD_ENCRYPTION_KEYS and BLIND_INDEX_KEY are not set.');
  process.exit(1);
}
const prisma = new PrismaClient();
const models = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const column = (model: string, field: string) => models.get(model)!.fields.find((f) => f.name === field)!.dbName ?? field;
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

async function main() {
  let pending = 0;
  for (const [model, fields] of Object.entries(ENCRYPTED_FIELDS)) {
    const table = models.get(model)!.dbName ?? model;
    const idx = BLIND_INDEXES[model] ?? {};
    const cols = [...fields.map((f) => column(model, f)), ...Object.values(idx)];
    // Anything not yet under the current key, or with a blind index still empty.
    const needs = [
      ...fields.map((f) => `(${q(column(model, f))} IS NOT NULL AND ${q(column(model, f))} <> '' AND ${q(column(model, f))} NOT LIKE 'enc:${fc!.currentId}:%')`),
      ...Object.entries(idx).map(([f, i]) => `(${q(column(model, f))} IS NOT NULL AND ${q(i)} IS NULL)`),
    ].join(' OR ');
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, string | null>>>(
      `SELECT id, ${cols.map(q).join(', ')} FROM ${q(table)} WHERE ${needs}`,
    );
    pending += rows.length;
    if (check || !rows.length) { console.log(`${model}: ${rows.length} to do`); continue; }
    for (const row of rows) {
      const sets: string[] = [];
      const values: unknown[] = [];
      for (const f of fields) {
        const v = row[column(model, f)];
        if (v && fc!.needsRewrite(v)) { values.push(fc!.encrypt(fc!.decrypt(v))); sets.push(`${q(column(model, f))} = $${values.length}`); }
        const i = idx[f];
        if (i && v) { values.push(fc!.blindIndex(v)); sets.push(`${q(i)} = $${values.length}`); }
      }
      if (!sets.length) continue;
      values.push(row.id);
      await prisma.$executeRawUnsafe(`UPDATE ${q(table)} SET ${sets.join(', ')} WHERE id = $${values.length}`, ...values);
    }
    console.log(`${model}: ${rows.length} rows written under key ${fc!.currentId}`);
  }
  if (check && pending) process.exitCode = 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
