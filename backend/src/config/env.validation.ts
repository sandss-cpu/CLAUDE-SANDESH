import { FieldCrypto } from '../common/crypto/field-crypto';

/**
 * Fail-fast environment validation.
 *
 * Two of the most dangerous misconfigurations in this system are silent:
 * a blank SMS gateway causes the login OTP to be returned in the API
 * response, and an unset CORS origin list falls back to a wildcard. Neither
 * throws at runtime. Both are checked here so the process refuses to start
 * rather than starting insecurely.
 */

const PLACEHOLDER_SECRETS = [
  'change-me-in-production-please',
  'change-me',
  'secret',
  'changeme',
];

export function validateEnv(config: Record<string, unknown>) {
  const errors: string[] = [];
  const isProd = config.NODE_ENV === 'production';
  const str = (k: string) => (config[k] as string | undefined)?.trim();

  // ---- always required ----
  if (!str('DATABASE_URL')) errors.push('DATABASE_URL is required');

  const trustProxy = str('TRUST_PROXY');
  if (trustProxy && !/^[0-5]$/.test(trustProxy)) {
    errors.push('TRUST_PROXY must be the number of proxies in front of the API (0–5); Render needs 1');
  }

  const secret = str('JWT_SECRET');
  if (!secret) {
    errors.push('JWT_SECRET is required');
  } else if (PLACEHOLDER_SECRETS.includes(secret.toLowerCase())) {
    errors.push('JWT_SECRET is still the example placeholder — generate a real one');
  } else if (secret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  // Encryption keys, when given, must be usable: a typo would otherwise surface as
  // unreadable phone numbers long after the fact.
  if (str('FIELD_ENCRYPTION_KEYS') || str('BLIND_INDEX_KEY')) {
    try {
      FieldCrypto.fromEnv({ FIELD_ENCRYPTION_KEYS: str('FIELD_ENCRYPTION_KEYS'), FIELD_ENCRYPTION_KEY_ID: str('FIELD_ENCRYPTION_KEY_ID'), BLIND_INDEX_KEY: str('BLIND_INDEX_KEY') } as NodeJS.ProcessEnv);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  // ---- production-only, and non-negotiable ----
  if (isProd) {
    // Personal fields are encrypted at rest; without keys they would be written in clear.
    if (!str('FIELD_ENCRYPTION_KEYS')) errors.push('FIELD_ENCRYPTION_KEYS is required in production (see SECURITY.md)');
    if (!str('BLIND_INDEX_KEY')) errors.push('BLIND_INDEX_KEY is required in production (see SECURITY.md)');
    // Rate limits are what stand between sign-in and a password-guessing script.
    if (/^(1|true|yes)$/i.test(str('THROTTLE_DISABLED') ?? '')) {
      errors.push('THROTTLE_DISABLED is for local test runs only; remove it in production');
    }
    // Phone login is optional in production; when it is on, a real gateway is
    // mandatory, because without one the login code is returned in the API
    // response, which is full account takeover.
    if (phoneLoginEnabled(str('PHONE_LOGIN_ENABLED'), 'production')) {
      if (!str('SMS_GATEWAY_URL')) {
        errors.push('SMS_GATEWAY_URL is required in production while PHONE_LOGIN_ENABLED=true');
      }
      if (!str('SMS_GATEWAY_TOKEN')) {
        errors.push('SMS_GATEWAY_TOKEN is required in production while PHONE_LOGIN_ENABLED=true');
      }
    }
    // Same reasoning for email: without SMTP the verification link would be
    // echoed back, letting anyone claim any address.
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM']) {
      if (!str(k)) errors.push(`${k} is required in production (email sign-in sends links)`);
    }
    const cors = str('CORS_ORIGINS');
    if (!cors) {
      errors.push('CORS_ORIGINS is required in production (no wildcard fallback)');
    } else if (cors.includes('*')) {
      errors.push('CORS_ORIGINS cannot contain a wildcard when credentials are allowed');
    }
    if (!str('PUBLIC_WEB_URL')?.startsWith('https://')) {
      errors.push('PUBLIC_WEB_URL must be https in production');
    }
    // Offline packs are cached from this host. If it is wrong or missing,
    // offline reading fails silently, which is the worst failure this
    // product can have.
    // Printed on every sticker and never changed afterwards, so it has to be right first time.
    // Private files (statement photos) are reached only through links signed with this.
    const signed = str('SIGNED_URL_SECRET');
    if (!signed || signed.length < 32) {
      errors.push('SIGNED_URL_SECRET must be set to at least 32 random characters in production');
    }
    // Files live in buckets in production: a server's own disk is lost on redeploy and
    // cannot be shared by two instances.
    if (str('STORAGE_DRIVER') !== 's3') {
      errors.push('STORAGE_DRIVER=s3 is required in production (private and public buckets, e.g. Cloudflare R2)');
    }
    if (str('STORAGE_DRIVER') === 's3') {
      for (const k of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_PUBLIC_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
        if (!str(k)) errors.push(`${k} is required when STORAGE_DRIVER=s3`);
      }
      if (str('S3_ENDPOINT') && !/^https:\/\//.test(str('S3_ENDPOINT')!)) errors.push('S3_ENDPOINT must be https');
    }
    if (!/^https:\/\//.test(str('MEDIA_BASE_URL') ?? '')) {
      errors.push('MEDIA_BASE_URL must be the https address the public bucket is served from');
    }
    // The public website: forms, newsletter links and cache purges depend on both.
    if (!/^https:\/\//.test(str('SITE_URL') ?? '')) errors.push('SITE_URL (the public website, https) is required in production');
    if ((str('SITE_API_KEY') ?? '').length < 32) errors.push('SITE_API_KEY must be at least 32 random characters in production');
    // Printed on every sticker and never changed afterwards: required, and https.
    const shortLinks = str('SHORT_LINK_BASE');
    if (!shortLinks || !shortLinks.startsWith('https://')) {
      errors.push('SHORT_LINK_BASE (https://<public domain>) is required in production: it is printed on every bus sticker');
    }
    const api = str('API_PUBLIC_URL');
    if (!api) {
      errors.push('API_PUBLIC_URL is required in production (offline packs are cached from it)');
    } else if (!api.startsWith('https://')) {
      errors.push('API_PUBLIC_URL must be https in production');
    }
  }

  if (errors.length) {
    throw new Error(
      `\n\nRefusing to start — environment is not safe:\n` +
      errors.map((e) => `  • ${e}`).join('\n') +
      `\n\nFix these in .env and start again.\n`,
    );
  }

  return config;
}

/** On by default in development; must be switched on explicitly in production. */
export function phoneLoginEnabled(flag: string | undefined, nodeEnv: string | undefined): boolean {
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return nodeEnv !== 'production';
}

/** True only when it is safe to hand a login code or link back over the API. */
export function otpMayBeReturnedInResponse(
  nodeEnv: string | undefined,
  smsConfigured: boolean,
): boolean {
  return nodeEnv !== 'production' && !smsConfigured;
}
