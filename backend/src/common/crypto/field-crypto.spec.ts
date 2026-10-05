import { randomBytes } from 'crypto';
import { decryptDeep, encryptData, FieldCrypto, normalisePhone } from './field-crypto';

const key = () => randomBytes(32).toString('base64');
const env = (keys: string, current?: string) =>
  ({ FIELD_ENCRYPTION_KEYS: keys, FIELD_ENCRYPTION_KEY_ID: current, BLIND_INDEX_KEY: key() }) as unknown as NodeJS.ProcessEnv;

describe('FieldCrypto', () => {
  const k1 = key();
  const k2 = key();
  const fc = FieldCrypto.fromEnv(env(`v1:${k1}`))!;

  it('takes a bare generated key as v1', () => {
    const bare = FieldCrypto.fromEnv(env(k1))!;
    expect(bare.currentId).toBe('v1');
    expect(bare.encrypt('x')).toMatch(/^enc:v1:/);
    expect(fc.decrypt(bare.encrypt('same key'))).toBe('same key');
  });

  it('is off without keys, and refuses malformed ones', () => {
    expect(FieldCrypto.fromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(() => FieldCrypto.fromEnv(env('v1:short'))).toThrow(/32 bytes/);
    expect(() => FieldCrypto.fromEnv(env(`v1:${k1}`, 'v9'))).toThrow(/not among/);
    expect(() => FieldCrypto.fromEnv({ FIELD_ENCRYPTION_KEYS: `v1:${k1}`, BLIND_INDEX_KEY: 'abc' } as unknown as NodeJS.ProcessEnv)).toThrow(/BLIND_INDEX_KEY/);
  });

  it('round-trips, with a fresh IV every time, and nothing readable in the stored form', () => {
    const a = fc.encrypt('9841234567');
    const b = fc.encrypt('9841234567');
    expect(a).toMatch(/^enc:v1:/);
    expect(a).not.toEqual(b);
    expect(a).not.toContain('9841234567');
    expect(fc.decrypt(a)).toBe('9841234567');
    expect(fc.decrypt('plain text from before')).toBe('plain text from before');
    expect(fc.encrypt(a)).toBe(a);
    expect(fc.decrypt(fc.encrypt('नेपाल ✓'))).toBe('नेपाल ✓');
  });

  it('detects tampering', () => {
    const a = fc.encrypt('licence 12-345');
    const parts = a.split('.');
    const ct = Buffer.from(parts[1], 'base64url');
    ct[0] ^= 1;
    expect(() => fc.decrypt([parts[0], ct.toString('base64url'), parts[2]].join('.'))).toThrow();
  });

  it('rotates: old values still read, new values use the newest key, and need rewriting is reported', () => {
    const old = fc.encrypt('old value');
    const both = FieldCrypto.fromEnv(env(`v1:${k1},v2:${k2}`))!;
    expect(both.currentId).toBe('v2');
    expect(both.decrypt(old)).toBe('old value');
    expect(both.needsRewrite(old)).toBe(true);
    expect(both.needsRewrite('plain')).toBe(true);
    const fresh = both.encrypt(both.decrypt(old));
    expect(fresh).toMatch(/^enc:v2:/);
    expect(both.needsRewrite(fresh)).toBe(false);
    expect(both.needsRewrite(null)).toBe(false);
    const onlyNew = FieldCrypto.fromEnv(env(`v2:${k2}`))!;
    expect(() => onlyNew.decrypt(old)).toThrow(/No key v1/);
  });

  it('blind index: the same number however it is written, different numbers differ', () => {
    expect(normalisePhone('+977 984-123-4567')).toBe('9841234567');
    expect(fc.blindIndex('+977 984-123-4567')).toBe(fc.blindIndex('9841234567'));
    expect(fc.blindIndex(fc.encrypt('9841234567'))).toBe(fc.blindIndex('9841234567'));
    expect(fc.blindIndex('9841234568')).not.toBe(fc.blindIndex('9841234567'));
    expect(fc.blindIndex(null)).toBeNull();
  });

  it('encrypts configured fields in nested writes, and fills the blind index', () => {
    const data: Record<string, any> = {
      name: 'Himalayan Express', contactPhone: '9801111111',
      drivers: { create: [{ name: 'Hari', phone: '9802222222', licenceNumber: 'L-1' }] },
    };
    encryptData('Operator', data, fc);
    expect(data.name).toBe('Himalayan Express');
    expect(data.contactPhone).toMatch(/^enc:/);
    expect(data.contactPhoneIdx).toBe(fc.blindIndex('9801111111'));
    expect(data.drivers.create[0].phone).toMatch(/^enc:/);
    expect(data.drivers.create[0].licenceNumber).toMatch(/^enc:/);
    expect(data.drivers.create[0].name).toBe('Hari');

    const update: Record<string, any> = { phone: { set: '9803333333' }, note: 'kept' };
    encryptData('Driver', update, fc);
    expect(update.phone.set).toMatch(/^enc:/);
    expect(update.note).toBe('kept');

    const cleared: Record<string, any> = { contactPhone: null };
    encryptData('Operator', cleared, fc);
    expect(cleared).toEqual({ contactPhone: null, contactPhoneIdx: null });
  });

  it('decrypts every encrypted string in a result, leaving dates and other values alone', () => {
    const when = new Date('2026-10-05T00:00:00Z');
    const result = decryptDeep([{ id: 'a', phone: fc.encrypt('9800000001'), at: when, trip: { driver: { phone: fc.encrypt('9800000002') } }, n: 3 }], fc);
    expect(result[0].phone).toBe('9800000001');
    expect(result[0].trip.driver.phone).toBe('9800000002');
    expect(result[0].at).toBe(when);
    expect(result[0].n).toBe(3);
    expect(decryptDeep('enc:v1:not-really', fc)).toBe('enc:v1:not-really');
  });
});
