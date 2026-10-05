import { createHash, createHmac } from 'crypto';

/**
 * AWS Signature Version 4 for S3-compatible storage (Cloudflare R2, AWS S3, MinIO), by
 * hand: two requests (a PUT with headers, a presigned GET) do not justify the AWS SDK.
 * Checked against AWS's own published examples in sigv4.spec.ts.
 */

export interface S3Credentials { accessKeyId: string; secretAccessKey: string; region: string }

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding, as SigV4 requires; slashes kept when encoding a path. */
export function uriEncode(value: string, keepSlash = false): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /(?!)/g, '/');
}

function signingKey(secret: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request');
}

/** The path as S3 signs it: each segment URI-encoded once ("$" becomes %24, which URL() leaves alone). */
export const canonicalPath = (url: URL) =>
  url.pathname.split('/').map((seg) => uriEncode(decodeURIComponent(seg))).join('/');

const amzDate = (at: Date) => at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** A GET URL anyone holding it can use until it expires; nothing else about the bucket is exposed. */
export function presignGet(url: URL, creds: S3Credentials, expiresSeconds: number, at = new Date(), extraQuery: Record<string, string> = {}): string {
  const stamp = amzDate(at);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${creds.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
    ...extraQuery,
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${uriEncode(k)}=${uriEncode(query[k])}`).join('&');
  const path = canonicalPath(url);
  const canonical = ['GET', path, canonicalQuery, `host:${url.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, day, creds.region)).update(toSign).digest('hex');
  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Headers for a signed request with a body (PUT) or none (DELETE, GET). Every header
 * passed in is signed; host, x-amz-date and x-amz-content-sha256 are added.
 */
export function signRequest(
  method: string, url: URL, creds: S3Credentials, body: Buffer | string = '', headers: Record<string, string> = {}, at = new Date(),
): Record<string, string> {
  const stamp = amzDate(at);
  const day = stamp.slice(0, 8);
  const scope = `${day}/${creds.region}/s3/aws4_request`;
  const payloadHash = sha256(body);
  const all: Record<string, string> = { ...headers, host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp };
  const names = Object.keys(all).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, ' ')]));
  const query = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
  const canonical = [
    method, canonicalPath(url), query,
    names.map((n) => `${n}:${lower[n]}`).join('\n'), '',
    names.join(';'), payloadHash,
  ].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, day, creds.region)).update(toSign).digest('hex');
  const { host: _host, ...sent } = all;
  return {
    ...sent,
    Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`,
  };
}
