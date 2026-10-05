import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';

/**
 * Field-level encryption for personal data at rest: drivers' phone and licence numbers,
 * companies' contact phones, travellers' emergency contacts, notes on income entries,
 * how to reach someone who sent a partner or Batoma a message, and authenticator
 * secrets.
 *
 * AES-256-GCM with a random 96-bit IV per value and versioned keys from the
 * environment. Stored as `enc:<key id>:<iv>.<ciphertext>.<tag>` (base64url), so a raw
 * database dump or backup shows nothing readable, and a key can be retired by
 * re-encrypting (`npm run fields:encrypt`). A value without the prefix is plaintext
 * from before encryption was switched on; it is read as it is and encrypted by the same
 * script.
 *
 * Encrypted values cannot be compared, so a column that is searched keeps a keyed hash
 * of its normalised value beside it (a blind index): equality only, never "contains".
 */

/** Model → fields stored encrypted. Prisma model names, as in schema.prisma. */
export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  User: ['totpSecret'],
  Driver: ['phone', 'licenceNumber'],
  Operator: ['contactPhone'],
  EmergencyContact: ['name', 'phone'],
  IncomeEntry: ['note'],
  BusinessLead: ['contact'],
  SiteEnquiry: ['contact'],
};

/** Model → { encrypted field: blind index field }. */
export const BLIND_INDEXES: Record<string, Record<string, string>> = {
  Operator: { contactPhone: 'contactPhoneIdx' },
};

const PREFIX = 'enc:';
const b64 = (b: Buffer) => b.toString('base64url');
const unb64 = (s: string) => Buffer.from(s, 'base64url');

/** Digits only, without Nepal's +977, so "+977 98-0000-0000" and "9800000000" match. */
export function normalisePhone(value: string): string {
  const d = value.replace(/\D/g, '');
  return d.length === 13 && d.startsWith('977') ? d.slice(3) : d;
}

export class FieldCrypto {
  private constructor(
    private readonly keys: Map<string, Buffer>,
    readonly currentId: string,
    private readonly indexKey: Buffer,
  ) {}

  /**
   * FIELD_ENCRYPTION_KEYS="v1:<base64 32 bytes>,v2:<base64 32 bytes>" (the last is used
   * for new values unless FIELD_ENCRYPTION_KEY_ID names another) and BLIND_INDEX_KEY.
   * Returns null when no keys are configured, which only development allows.
   */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): FieldCrypto | null {
    const raw = (env.FIELD_ENCRYPTION_KEYS ?? '').trim();
    if (!raw) return null;
    const keys = new Map<string, Buffer>();
    // A bare key (Render's generated value) is key "v1"; add "v2:<key>" after it to rotate.
    for (const part of raw.split(',').map((p, n) => (n === 0 && !/^[a-z0-9]{1,8}:/i.test(p.trim()) ? `v1:${p.trim()}` : p.trim())).filter(Boolean)) {
      const i = part.indexOf(':');
      const id = part.slice(0, i);
      const key = Buffer.from(part.slice(i + 1), 'base64');
      if (i < 1 || !/^[a-z0-9]{1,8}$/i.test(id)) throw new Error(`FIELD_ENCRYPTION_KEYS: "${id || part.slice(0, 4)}…" needs the form id:base64key`);
      if (key.length !== 32) throw new Error(`FIELD_ENCRYPTION_KEYS: key ${id} must be 32 bytes (base64 of 32 random bytes)`);
      keys.set(id, key);
    }
    const currentId = (env.FIELD_ENCRYPTION_KEY_ID ?? '').trim() || [...keys.keys()].pop()!;
    if (!keys.has(currentId)) throw new Error(`FIELD_ENCRYPTION_KEY_ID ${currentId} is not among FIELD_ENCRYPTION_KEYS`);
    const indexKey = Buffer.from((env.BLIND_INDEX_KEY ?? '').trim(), 'base64');
    if (indexKey.length < 32) throw new Error('BLIND_INDEX_KEY must be at least 32 bytes (base64)');
    return new FieldCrypto(keys, currentId, indexKey);
  }

  static isEncrypted(value: unknown): value is string {
    return typeof value === 'string' && value.startsWith(PREFIX);
  }

  encrypt(plain: string): string {
    if (FieldCrypto.isEncrypted(plain)) return plain;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.currentId)!, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `${PREFIX}${this.currentId}:${b64(iv)}.${b64(ct)}.${b64(cipher.getAuthTag())}`;
  }

  /** Plaintext passes through; a value that fails its tag check throws. */
  decrypt(value: string): string {
    if (!FieldCrypto.isEncrypted(value)) return value;
    const rest = value.slice(PREFIX.length);
    const colon = rest.indexOf(':');
    const id = rest.slice(0, colon);
    const key = this.keys.get(id);
    if (!key) throw new Error(`No key ${id} to decrypt with`);
    const [iv, ct, tag] = rest.slice(colon + 1).split('.').map(unb64);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /** Plaintext, or encrypted under a key other than the current one. */
  needsRewrite(value: string | null | undefined): boolean {
    if (value == null || value === '') return false;
    return !value.startsWith(`${PREFIX}${this.currentId}:`);
  }

  blindIndex(value: string | null | undefined): string | null {
    if (value == null) return null;
    const n = normalisePhone(this.decrypt(value));
    return n ? createHmac('sha256', this.indexKey).update(n).digest('hex') : null;
  }
}

// ================= Prisma: encrypt what is written, decrypt what is read =================

/** Relation fields of each model, from Prisma's own schema description. */
const RELATIONS: Record<string, Record<string, string>> = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, Object.fromEntries(m.fields.filter((f) => f.kind === 'object').map((f) => [f.name, f.type]))]),
);

type Data = Record<string, unknown>;
const isPlain = (v: unknown): v is Data => !!v && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const each = (v: unknown, fn: (d: Data) => void) => { for (const d of Array.isArray(v) ? v : [v]) if (isPlain(d)) fn(d); };

/** Encrypts a create or update payload in place, nested writes included. */
export function encryptData(model: string, data: unknown, fc: FieldCrypto): void {
  each(data, (d) => {
    const fields = ENCRYPTED_FIELDS[model] ?? [];
    for (const field of fields) {
      if (!(field in d)) continue;
      const v = d[field];
      const plain = typeof v === 'string' ? v : isPlain(v) && typeof v.set === 'string' ? (v.set as string) : null;
      if (plain !== null) {
        const enc = plain === '' ? '' : fc.encrypt(plain);
        if (typeof v === 'string') d[field] = enc; else (v as Data).set = enc;
      }
      const idx = BLIND_INDEXES[model]?.[field];
      if (idx && (plain !== null || v === null)) d[idx] = plain ? fc.blindIndex(plain) : null;
    }
    for (const [rel, target] of Object.entries(RELATIONS[model] ?? {})) {
      const nested = d[rel];
      if (!isPlain(nested)) continue;
      if (nested.create) encryptData(target, nested.create, fc);
      if (isPlain(nested.createMany)) encryptData(target, nested.createMany.data, fc);
      each(nested.connectOrCreate, (c) => encryptData(target, c.create, fc));
      each(nested.update, (u) => encryptData(target, 'data' in u ? u.data : u, fc));
      each(nested.updateMany, (u) => encryptData(target, u.data, fc));
      each(nested.upsert, (u) => { encryptData(target, u.create, fc); encryptData(target, u.update, fc); });
    }
  });
}

/** Decrypts every encrypted string in a result, however deeply it is nested. */
export function decryptDeep<T>(value: T, fc: FieldCrypto): T {
  if (typeof value === 'string') return (FieldCrypto.isEncrypted(value) ? safeDecrypt(value, fc) : value) as T;
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) value[i] = decryptDeep(value[i], fc); return value; }
  if (isPlain(value)) { const o: Data = value; for (const k of Object.keys(o)) o[k] = decryptDeep(o[k], fc); }
  return value;
}

function safeDecrypt(value: string, fc: FieldCrypto): string {
  try { return fc.decrypt(value); } catch { return value; }
}

const WRITES = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'upsert']);

export function fieldEncryptionMiddleware(fc: FieldCrypto): Prisma.Middleware {
  return async (params, next) => {
    if (params.model && WRITES.has(params.action) && params.args) {
      const a = params.args as Data;
      if (params.action === 'upsert') { encryptData(params.model, a.create, fc); encryptData(params.model, a.update, fc); }
      else encryptData(params.model, a.data, fc);
    }
    return decryptDeep(await next(params), fc);
  };
}

/** For scripts that make their own PrismaClient: the same encryption as the API, when keys are set. */
export function withFieldEncryption<C extends { $use(m: Prisma.Middleware): void }>(client: C, env = process.env): C {
  // Scripts run with ts-node get no help from Nest's ConfigModule: read .env if it is there.
  if (!env.FIELD_ENCRYPTION_KEYS) { try { process.loadEnvFile('.env'); } catch { /* none */ } }
  const fc = FieldCrypto.fromEnv(env);
  if (fc) client.$use(fieldEncryptionMiddleware(fc));
  return client;
}
