import { customAlphabet } from 'nanoid';

const codeAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I — read off a sticker
export const shortCode = customAlphabet(codeAlphabet, 8);
export const couponCode = customAlphabet(codeAlphabet, 6);
export const shareToken = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 16);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Appends -2, -3 … until the slug is free. */
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base) || 'item';
  let candidate = root;
  let n = 1;
  while (await exists(candidate)) { n += 1; candidate = `${root}-${n}`; }
  return candidate;
}

export function readMinutes(body: string): number {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
