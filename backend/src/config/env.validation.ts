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

  // ---- production-only, and non-negotiable ----
  if (isProd) {
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
