import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * New and changed passwords: at least 10 characters, not one of the 10,000 most common
 * passwords (assets/common-passwords.txt), not a common word with a few digits or
 * symbols tacked on ("password2024!"), not one character repeated, and not built on the
 * service's name or the person's own name or email. Length beats complexity rules,
 * which only push people to "Password1!".
 */
export const MIN_PASSWORD_LENGTH = 10;

let common: Set<string> | null = null;
function commonPasswords(): Set<string> {
  if (!common) {
    // Same relative path from src/ (tests, ts-node) and dist/ (the built API).
    const text = readFileSync(join(__dirname, '../../../assets/common-passwords.txt'), 'utf8');
    common = new Set(text.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean));
  }
  return common;
}

/** Returns a sentence saying what is wrong, or null when the password is acceptable. */
export function passwordProblem(password: string, context: { email?: string | null; name?: string | null } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`;
  if (password.length > 128) return 'Use at most 128 characters for your password.';
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(lower)) return 'That password is one character repeated. Choose something harder to guess.';
  const list = commonPasswords();
  const base = lower.replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, '');
  if (list.has(lower) || (base.length >= 4 && lower.length - base.length <= 6 && list.has(base))) {
    return 'That password is one of the most common ones. Choose something less guessable, such as three or four unrelated words.';
  }
  const words = ['batoma', 'bato', ...(context.email ? [context.email.split('@')[0]] : []), ...(context.name ?? '').split(/\s+/)]
    .map((w) => w.toLowerCase()).filter((w) => w.length >= 4);
  if (words.some((w) => lower.includes(w))) return 'Your password should not contain your name, your email or "Batoma".';
  return null;
}
