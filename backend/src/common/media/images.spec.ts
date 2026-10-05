import sharp from 'sharp';
import { imageKind, isPdf, NotAnImageError, publicVariants, reencode, srcsetFor } from './images';

/** A JPEG with EXIF (camera, GPS) and a portrait orientation flag. */
async function phonePhoto(width = 2000, height = 1200) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '27/1 42/1 0/1' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe('images', () => {
  it('knows images and PDFs by their bytes, not their names', async () => {
    expect(imageKind(await phonePhoto(20, 20))).toBe('jpg');
    expect(imageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(imageKind(Buffer.from('GIF89a........'))).toBeNull();
    expect(isPdf(Buffer.from('%PDF-1.7\n%...'))).toBe(true);
    expect(isPdf(Buffer.from('<html>%PDF-'))).toBe(false);
  });

  it('re-encodes: no EXIF or GPS left, orientation applied, size capped', async () => {
    const original = await phonePhoto();
    expect((await sharp(original).metadata()).exif).toBeDefined();
    const out = await reencode(original, 1000);
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation ?? 1).toBe(1);
    // 2000×1200 turned upright is 1200×2000, then capped at 1000 wide.
    expect([out.width, out.height]).toEqual([1000, 1667]);
    expect(out.buffer.includes(Buffer.from('TestPhone'))).toBe(false);
  });

  it('refuses something that only looks like an image', async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<script>alert(1)</script>'.repeat(4))]);
    await expect(reencode(fake)).rejects.toBeInstanceOf(NotAnImageError);
    await expect(reencode(Buffer.from('plain text pretending'))).rejects.toBeInstanceOf(NotAnImageError);
  });

  it('makes the website sizes, never wider than the original', async () => {
    // The phone photo is portrait once turned upright: 1200 wide.
    const turned = await publicVariants(await phonePhoto(2000, 1200));
    expect(turned.variants.map((v) => v.width)).toEqual([480, 960, 1200]);
    const wide = await publicVariants(await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#998877' } }).jpeg().toBuffer());
    expect(wide.variants.map((v) => v.width)).toEqual([480, 960, 1600]);
    expect(wide.height).toBe(1067);
    const small = await publicVariants(await sharp({ create: { width: 700, height: 400, channels: 3, background: '#336699' } }).png().toBuffer());
    expect(small.variants.map((v) => v.width)).toEqual([480, 700]);
    expect(srcsetFor('https://x/uploads/abc-700.webp')).toEqual([
      { url: 'https://x/uploads/abc-480.webp', width: 480 }, { url: 'https://x/uploads/abc-700.webp', width: 700 },
    ]);
    expect(srcsetFor('https://x/uploads/old-photo.jpg')).toBeNull();
  });
});
