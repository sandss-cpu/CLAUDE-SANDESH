import sharp from 'sharp';

/**
 * Every uploaded picture is decoded and drawn again before it is kept. What is stored
 * is a fresh WebP made from the pixels alone: no EXIF (a phone photo's GPS position,
 * camera serial and date go with it), no embedded profiles or comments, nothing an
 * attacker hid after the image data. A file that is not really an image fails to decode
 * and is refused.
 */

export type ImageKind = 'jpg' | 'png' | 'webp' | 'avif';

/** What a file really is, from its first bytes, never its name. */
export function imageKind(b: Buffer): ImageKind | null {
  if (b.length < 16) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (b.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(b.subarray(8, 12).toString('ascii'))) return 'avif';
  return null;
}

export const isPdf = (b: Buffer) => b.length > 8 && b.subarray(0, 5).toString('latin1') === '%PDF-';

/** Widths made for the website's srcset; the largest made is never wider than the original. */
export const PUBLIC_WIDTHS = [480, 960, 1600] as const;
/** Refuses decompression bombs: a small file that expands to gigapixels. */
const MAX_PIXELS = 40_000_000;

export class NotAnImageError extends Error {}

async function load(input: Buffer) {
  if (!imageKind(input)) throw new NotAnImageError('Not a JPG, PNG, WebP or AVIF image');
  const img = sharp(input, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate();
  const meta = await img.metadata().catch(() => { throw new NotAnImageError('The image could not be read'); });
  if (!meta.width || !meta.height) throw new NotAnImageError('The image has no size');
  // After .rotate() a portrait photo's EXIF orientation swaps width and height.
  const turned = (meta.orientation ?? 1) >= 5;
  return { img, width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height };
}

/** One clean copy, at most `maxWidth` wide: statement photos and verification documents. */
export async function reencode(input: Buffer, maxWidth = 2400): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { img, width } = await load(input);
  const { data, info } = await img.resize({ width: Math.min(width, maxWidth), withoutEnlargement: true })
    .webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}

/**
 * The sizes the website and app pick from. Files are named `<id>-<width>.webp`, so a
 * page can work out the srcset from the largest one's address.
 */
export async function publicVariants(input: Buffer): Promise<{ width: number; height: number; variants: Array<{ width: number; buffer: Buffer }> }> {
  const { img, width, height } = await load(input);
  const largest = Math.min(width, PUBLIC_WIDTHS[PUBLIC_WIDTHS.length - 1]);
  const widths = [...new Set([...PUBLIC_WIDTHS.filter((w) => w < largest), largest])];
  const variants = await Promise.all(widths.map(async (w) => ({
    width: w,
    buffer: await img.clone().resize({ width: w, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer(),
  })));
  return { width: largest, height: Math.round((height * largest) / width), variants };
}

/** The srcset for an upload named `<id>-<width>.webp`: every smaller standard width, then its own. */
export function srcsetFor(url: string): Array<{ url: string; width: number }> | null {
  const m = /^(.*)-(\d{2,4})\.webp$/.exec(url);
  if (!m) return null;
  const top = Number(m[2]);
  return [...PUBLIC_WIDTHS.filter((w) => w < top), top].map((w) => ({ url: `${m[1]}-${w}.webp`, width: w }));
}
