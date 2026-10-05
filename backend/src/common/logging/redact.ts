/**
 * What never reaches a log line or an error report: email addresses, phone numbers,
 * bearer tokens and JWTs, passwords and codes in key=value text, and the secret parts
 * of signed links (?sig=, ?token=, ?verify=, ?reset=). Applied to every message, so a
 * careless `logger.warn(\`... ${user.email}\`)` written later is still safe.
 */
const RULES: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [token]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[jwt]'],
  [/([?&](?:sig|signature|token|verify|reset|code|key|X-Amz-Signature|X-Amz-Credential)=)[^&\s"']+/gi, '$1[redacted]'],
  [/("?(?:password|passwordHash|totpSecret|refreshToken|accessToken|secret|code|otp)"?\s*[:=]\s*"?)[^",\s}]+/gi, '$1[redacted]'],
  [/\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, (_m, first, domain) => `${first}***@${domain}`],
  [/(\+?\d[\d\s-]{6,}\d)/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 9 && digits.length <= 15 ? `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}` : m;
  }],
];

export function redact(text: string): string {
  let out = String(text);
  for (const [re, to] of RULES) out = out.replace(re, to as never);
  return out;
}

/** Deep copy with every string redacted, for structured payloads (error reports). */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) =>
      [k, /password|secret|token|cookie|authorization|totp|otp|signature/i.test(k) ? '[redacted]' : redactDeep(v, depth + 1)])) as T;
  }
  return value;
}
