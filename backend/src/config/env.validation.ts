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
    if (!str('SMS_GATEWAY_URL')) {
      errors.push(
        'SMS_GATEWAY_URL is required in production. Without it the login code is ' +
        'returned in the API response, which is full account takeover.',
      );
    }
    if (!str('SMS_GATEWAY_TOKEN')) {
      errors.push('SMS_GATEWAY_TOKEN is required in production');
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

/** True only when it is safe to hand a login code back over the API. */
export function otpMayBeReturnedInResponse(
  nodeEnv: string | undefined,
  smsConfigured: boolean,
): boolean {
  return nodeEnv !== 'production' && !smsConfigured;
}
