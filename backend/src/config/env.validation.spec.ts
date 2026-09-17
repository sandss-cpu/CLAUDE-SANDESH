import { otpMayBeReturnedInResponse, phoneLoginEnabled, validateEnv } from './env.validation';

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
