import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import { presignGet, S3Credentials, signRequest, uriEncode } from './sigv4';

/**
 * Private files: statement photos now, verification documents later. Nothing here is
 * ever public. A file is reached only through a signed link that expires in minutes,
 * handed out after the API has checked who is asking.
 *
 * - `disk` (development, or a single server): files under PRIVATE_UPLOAD_DIR, which is
 *   never served statically; links point at /files/:key on this API, signed with HMAC.
 * - `s3` (production): any S3-compatible bucket, Cloudflare R2 included, kept private;
 *   links are S3 presigned GETs.
 */

/** Keys are made here, never taken from a request: area/owner-id/file-id.ext. */
export const KEY_PATTERN = /^[a-z-]+\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
export const contentTypeOf = (key: string) => TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream';

@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly driver: 'disk' | 's3';
  private readonly dir: string;
  private readonly secret: string;
  private readonly s3?: { endpoint: string; bucket: string; creds: S3Credentials };

  constructor(private config: ConfigService) {
    this.driver = config.get<string>('STORAGE_DRIVER') === 's3' ? 's3' : 'disk';
    this.dir = resolve(process.cwd(), config.get<string>('PRIVATE_UPLOAD_DIR') || 'private-uploads');
    // A separate secret in production (env validation insists); derived from the JWT secret in development.
    this.secret = config.get<string>('SIGNED_URL_SECRET')
      || createHmac('sha256', config.get<string>('JWT_SECRET') ?? 'dev').update('batoma-signed-urls').digest('hex');
    if (this.driver === 's3') {
      this.s3 = {
        endpoint: (config.get<string>('S3_ENDPOINT') ?? '').replace(/\/$/, ''),
        bucket: config.get<string>('S3_BUCKET') ?? '',
        creds: {
          accessKeyId: config.get<string>('S3_ACCESS_KEY_ID') ?? '',
          secretAccessKey: config.get<string>('S3_SECRET_ACCESS_KEY') ?? '',
          region: config.get<string>('S3_REGION') || 'auto',
        },
      };
    }
  }

  private path(key: string) {
    if (!KEY_PATTERN.test(key)) throw new NotFoundException('File not found');
    const full = resolve(this.dir, key);
    if (!full.startsWith(this.dir + sep)) throw new NotFoundException('File not found');
    return full;
  }

  /** Path-style object URL: works for R2, MinIO and S3 alike. */
  private objectUrl(key: string) {
    return new URL(`${this.s3!.endpoint}/${uriEncode(this.s3!.bucket)}/${uriEncode(key, true)}`);
  }

  async put(key: string, body: Buffer): Promise<void> {
    if (this.driver === 'disk') {
      const full = this.path(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, body, { mode: 0o600 });
      return;
    }
    const url = this.objectUrl(key);
    const headers = signRequest('PUT', url, this.s3!.creds, body, { 'content-type': contentTypeOf(key) });
    const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) });
    if (!res.ok) {
      this.log.error(`Storage PUT failed: ${res.status}`);
      throw new Error('The file could not be stored. Try again in a minute.');
    }
  }

  async remove(key: string): Promise<void> {
    if (this.driver === 'disk') {
      await unlink(this.path(key)).catch(() => undefined);
      return;
    }
    const url = this.objectUrl(key);
    await fetch(url, { method: 'DELETE', headers: signRequest('DELETE', url, this.s3!.creds) }).catch(() => undefined);
  }

  /** A link to the file that works for `seconds`, for whoever the API has already allowed to see it. */
  signedUrl(key: string, seconds = 300): string {
    if (this.driver === 's3') {
      return presignGet(this.objectUrl(key), this.s3!.creds, seconds, new Date(), {
        'response-cache-control': 'private, no-store',
        // A PDF is saved, never opened inside the browser on the bucket's origin.
        ...(key.endsWith('.pdf') ? { 'response-content-disposition': 'attachment' } : {}),
      });
    }
    const exp = Math.floor(Date.now() / 1000) + seconds;
    const base = (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:3000').replace(/\/$/, '');
    return `${base}/api/v1/files/${encodeURIComponent(key)}?exp=${exp}&sig=${this.sign(key, exp)}`;
  }

  private sign(key: string, exp: number) {
    return createHmac('sha256', this.secret).update(`${key}\n${exp}`).digest('base64url');
  }

  /** For the disk driver's /files route: the file, if the link is genuine and in date. */
  async readSigned(key: string, exp: string, sig: string): Promise<Buffer> {
    const expiry = Number(exp);
    const expected = Buffer.from(this.sign(key, expiry));
    const given = Buffer.from(String(sig ?? ''));
    const genuine = given.length === expected.length && timingSafeEqual(given, expected);
    if (this.driver !== 'disk' || !Number.isInteger(expiry) || expiry < Date.now() / 1000 || !genuine) {
      throw new NotFoundException('This link has expired. Open the file again from Batoma.');
    }
    try {
      return await readFile(this.path(key));
    } catch {
      throw new NotFoundException('File not found');
    }
  }

  /** Where disk files live, for tests and clean-up scripts. */
  get diskRoot() { return join(this.dir); }
}
