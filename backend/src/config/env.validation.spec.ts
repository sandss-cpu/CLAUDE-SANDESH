import { randomBytes } from 'crypto';
import { otpMayBeReturnedInResponse, phoneLoginEnabled, validateEnv } from './env.validation';

const KEYS = { FIELD_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('base64')}`, BLIND_INDEX_KEY: randomBytes(32).toString('base64') };

const SECRET = 'x'.repeat(40);
const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: SECRET };

const prod = (extra: Record<string, unknown> = {}) => ({
  ...base,
  NODE_ENV: 'production',
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'user',
  SMTP_PASS: 'pass',
  MAIL_FROM: 'Bato <no-reply@example.com>',
  CORS_ORIGINS: 'https://app.example.com',
  PUBLIC_WEB_URL: 'https://app.example.com',
  API_PUBLIC_URL: 'https://api.example.com',
  SIGNED_URL_SECRET: 'y'.repeat(40),
  STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'private', S3_PUBLIC_BUCKET: 'public',
  S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's', MEDIA_BASE_URL: 'https://media.batoma.example',
  SITE_URL: 'https://batoma.example', SITE_API_KEY: 'k'.repeat(40), SHORT_LINK_BASE: 'https://batoma.example',
  ...KEYS,
  ...extra,
});

describe('validateEnv — always', () => {
  it('accepts a sane development environment', () => {
    expect(() => validateEnv({ ...base })).not.toThrow();
  });

  it('requires a database', () => {
    expect(() => validateEnv({ JWT_SECRET: SECRET })).toThrow(/DATABASE_URL is required/);
  });

  it('rejects a short signing secret', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'tooshort' })).toThrow(/at least 32 characters/);
  });

  it('rejects the example placeholder secret', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: 'change-me-in-production-please' }))
      .toThrow(/still the example placeholder/);
  });

  it('rejects a nonsense proxy count', () => {
    expect(() => validateEnv({ ...base, TRUST_PROXY: '9' })).toThrow(/TRUST_PROXY/);
  });
});

describe('validateEnv — production refuses to start insecurely', () => {
  it('accepts a complete production environment', () => {
    expect(() => validateEnv(prod())).not.toThrow();
  });

  /** Without SMTP the verification link would be echoed back by the API. */
  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'])('requires %s', (key) => {
    expect(() => validateEnv(prod({ [key]: '' }))).toThrow(new RegExp(key));
  });

  it('refuses a wildcard CORS origin, which would expose signed-in users', () => {
    expect(() => validateEnv(prod({ CORS_ORIGINS: '*' }))).toThrow(/wildcard/);
  });

  it('refuses a missing CORS list', () => {
    expect(() => validateEnv(prod({ CORS_ORIGINS: '' }))).toThrow(/CORS_ORIGINS is required/);
  });

  it.each(['PUBLIC_WEB_URL', 'API_PUBLIC_URL'])('requires %s to be https', (key) => {
    expect(() => validateEnv(prod({ [key]: 'http://insecure.example.com' }))).toThrow(new RegExp(key));
  });

  it('demands an SMS gateway only when phone login is on', () => {
    expect(() => validateEnv(prod({ PHONE_LOGIN_ENABLED: 'true' }))).toThrow(/SMS_GATEWAY_URL/);
    expect(() => validateEnv(prod({ PHONE_LOGIN_ENABLED: 'false' }))).not.toThrow();
  });

  it('lists every problem at once, rather than one per restart', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET/);
  });
});

describe('phoneLoginEnabled', () => {
  it('is on by default in development', () => {
    expect(phoneLoginEnabled(undefined, 'development')).toBe(true);
  });

  it('must be switched on explicitly in production', () => {
    expect(phoneLoginEnabled(undefined, 'production')).toBe(false);
    expect(phoneLoginEnabled('true', 'production')).toBe(true);
  });

  it('honours an explicit off', () => {
    expect(phoneLoginEnabled('false', 'development')).toBe(false);
  });
});

describe('otpMayBeReturnedInResponse', () => {
  /** Returning the code in production would be account takeover, gateway or not. */
  it('is never true in production', () => {
    expect(otpMayBeReturnedInResponse('production', false)).toBe(false);
    expect(otpMayBeReturnedInResponse('production', true)).toBe(false);
  });

  it('is true only in development with no gateway configured', () => {
    expect(otpMayBeReturnedInResponse('development', false)).toBe(true);
    expect(otpMayBeReturnedInResponse('development', true)).toBe(false);
  });
});

describe('validateEnv — rate limits', () => {
  it('lets a local test run switch them off', () => {
    expect(() => validateEnv({ ...base, THROTTLE_DISABLED: 'true' })).not.toThrow();
  });

  it('refuses to start in production with them switched off', () => {
    expect(() => validateEnv(prod({ THROTTLE_DISABLED: 'true' }))).toThrow(/THROTTLE_DISABLED/);
  });
});

describe('validateEnv — sticker links', () => {
  it('refuses a plain-http short link in production', () => {
    expect(() => validateEnv(prod({ SHORT_LINK_BASE: 'http://batoma.example' }))).toThrow(/SHORT_LINK_BASE/);
  });
  it('accepts an https one', () => {
    expect(() => validateEnv(prod({ SHORT_LINK_BASE: 'https://batoma.example' }))).not.toThrow();
  });
});

describe('validateEnv — private files', () => {
  it('needs a signing secret for private links in production', () => {
    expect(() => validateEnv(prod({ SIGNED_URL_SECRET: undefined }))).toThrow(/SIGNED_URL_SECRET/);
    expect(() => validateEnv(prod({ SIGNED_URL_SECRET: 'short' }))).toThrow(/SIGNED_URL_SECRET/);
  });
  it('needs every bucket setting for S3 storage', () => {
    expect(() => validateEnv(prod({ S3_BUCKET: undefined }))).toThrow(/S3_BUCKET is required/);
    expect(() => validateEnv(prod({
      STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's',
    }))).not.toThrow();
  });
});

describe('validateEnv — public website', () => {
  it('needs https and a long shared key for the site in production', () => {
    expect(() => validateEnv(prod({ SITE_URL: 'http://batoma.example', SITE_API_KEY: 'k'.repeat(40) }))).toThrow(/SITE_URL/);
    expect(() => validateEnv(prod({ SITE_URL: 'https://batoma.example', SITE_API_KEY: 'short' }))).toThrow(/SITE_API_KEY/);
    expect(() => validateEnv(prod({ SITE_URL: 'https://batoma.example', SITE_API_KEY: 'k'.repeat(40) }))).not.toThrow();
  });
});

describe('validateEnv — field encryption', () => {
  it('needs both keys in production', () => {
    expect(() => validateEnv(prod({ FIELD_ENCRYPTION_KEYS: undefined }))).toThrow(/FIELD_ENCRYPTION_KEYS is required/);
    expect(() => validateEnv(prod({ BLIND_INDEX_KEY: undefined }))).toThrow(/BLIND_INDEX_KEY/);
  });
  it('refuses a malformed key anywhere, so a typo cannot make fields unreadable later', () => {
    expect(() => validateEnv({ ...base, FIELD_ENCRYPTION_KEYS: 'v1:tooshort', BLIND_INDEX_KEY: KEYS.BLIND_INDEX_KEY })).toThrow(/32 bytes/);
    expect(() => validateEnv({ ...base, ...KEYS })).not.toThrow();
  });
});

describe('validateEnv — ready to host', () => {
  it('keeps files in buckets, never on the server disk', () => {
    expect(() => validateEnv(prod({ STORAGE_DRIVER: 'disk' }))).toThrow(/STORAGE_DRIVER=s3/);
    expect(() => validateEnv(prod({ S3_PUBLIC_BUCKET: undefined }))).toThrow(/S3_PUBLIC_BUCKET/);
    expect(() => validateEnv(prod({ MEDIA_BASE_URL: 'http://media.example' }))).toThrow(/MEDIA_BASE_URL/);
  });
  it('needs the sticker address and the website before it starts', () => {
    expect(() => validateEnv(prod({ SHORT_LINK_BASE: undefined }))).toThrow(/SHORT_LINK_BASE/);
    expect(() => validateEnv(prod({ SITE_URL: undefined }))).toThrow(/SITE_URL/);
  });
});
