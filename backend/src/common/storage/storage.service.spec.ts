import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageService } from './storage.service';

describe('private storage on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'batoma-private-'));
  const storage = new StorageService(new ConfigService({ PRIVATE_UPLOAD_DIR: dir, JWT_SECRET: 'x'.repeat(40), API_PUBLIC_URL: 'http://api.test' }));
  const key = 'income/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png';
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('hands out a link that opens the file until it expires', async () => {
    await storage.put(key, Buffer.from('png bytes'));
    const url = new URL(storage.signedUrl(key, 60));
    expect(url.pathname).toBe(`/api/v1/files/${encodeURIComponent(key)}`);
    const body = await storage.readSigned(key, url.searchParams.get('exp')!, url.searchParams.get('sig')!);
    expect(body.toString()).toBe('png bytes');
  });

  it('refuses a forged, altered or expired link', async () => {
    const url = new URL(storage.signedUrl(key, 60));
    const exp = url.searchParams.get('exp')!;
    const sig = url.searchParams.get('sig')!;
    const forged = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    await expect(storage.readSigned(key, exp, forged)).rejects.toThrow(/expired/);
    await expect(storage.readSigned(key, String(Number(exp) + 60), sig)).rejects.toThrow(/expired/);
    const old = new URL(storage.signedUrl(key, -1));
    await expect(storage.readSigned(key, old.searchParams.get('exp')!, old.searchParams.get('sig')!)).rejects.toThrow(/expired/);
  });

  it('only stores keys it could have made itself', async () => {
    await expect(storage.put('../../etc/passwd', Buffer.from('x'))).rejects.toThrow(/not found/i);
    await expect(storage.put('income/x/y.png', Buffer.from('x'))).rejects.toThrow(/not found/i);
  });
});
