// Prints the plain text of one encrypted field value (argv[2]), using the keys in .env.
// For the smoke scripts, which read authenticator secrets straight from the database.
// Plain text passes through unchanged.
import { createDecipheriv } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

try { process.loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '../.env')); } catch { /* set elsewhere */ }
const value = process.argv[2] ?? '';
if (!value.startsWith('enc:')) { process.stdout.write(value); process.exit(0); }
const keys = new Map((process.env.FIELD_ENCRYPTION_KEYS ?? '').split(',').filter(Boolean).map((p) => {
  const i = p.indexOf(':');
  return [p.slice(0, i).trim(), Buffer.from(p.slice(i + 1).trim(), 'base64')];
}));
const rest = value.slice(4);
const id = rest.slice(0, rest.indexOf(':'));
const [iv, ct, tag] = rest.slice(id.length + 1).split('.').map((s) => Buffer.from(s, 'base64url'));
const d = createDecipheriv('aes-256-gcm', keys.get(id), iv);
d.setAuthTag(tag);
process.stdout.write(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
