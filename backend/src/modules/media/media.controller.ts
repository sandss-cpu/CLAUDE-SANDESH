import {
  BadRequestException, Controller, Post, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { open, unlink } from 'fs/promises';

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];

/**
 * Real file signatures. An extension check alone is not validation — the
 * name is attacker-controlled, and these files are served back over HTTP.
 */
const SIGNATURES: Array<{ label: string; test: (b: Buffer) => boolean }> = [
  { label: 'jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { label: 'png',  test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  { label: 'webp', test: (b) => b.subarray(0,4).toString('ascii') === 'RIFF' && b.subarray(8,12).toString('ascii') === 'WEBP' },
  { label: 'avif', test: (b) => b.subarray(4,8).toString('ascii') === 'ftyp' && /avif|avis|mif1/.test(b.subarray(8,16).toString('ascii')) },
];

async function looksLikeAnImage(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const { buffer } = await handle.read(Buffer.alloc(32), 0, 32, 0);
    return SIGNATURES.some((s) => s.test(buffer));
  } finally {
    await handle.close();
  }
}

@Controller('media')
export class MediaController {
  constructor(private config: ConfigService) {}

  /**
   * Local disk in development. In production point this at S3-compatible
   * storage on a separate origin — serving user uploads from the API's own
   * domain turns any content-sniffing slip into same-origin script execution.
   */
  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: process.env.UPLOAD_DIR || './uploads',
        // The original filename is never reused: no path traversal, no collisions.
        filename: (_req, file, cb) =>
          cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
      }),
      limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 8) * 1024 * 1024, files: 10 },
      fileFilter: (_req, file, cb) => {
        const ok = ALLOWED_EXT.includes(extname(file.originalname).toLowerCase());
        cb(ok ? null : new BadRequestException('Only JPG, PNG, WebP or AVIF images'), ok);
      },
    }),
  )
  async upload(@UploadedFiles() files: Array<{ filename: string; size: number; path: string }>) {
    const base = this.config.get('MEDIA_BASE_URL');
    const dir = process.env.UPLOAD_DIR || './uploads';
    const accepted: Array<{ url: string; sizeBytes: number }> = [];
    const rejected: string[] = [];

    for (const f of files ?? []) {
      const path = f.path ?? join(dir, f.filename);
      let valid = false;
      try { valid = await looksLikeAnImage(path); } catch (_) { valid = false; }

      if (valid) {
        accepted.push({ url: `${base}/${f.filename}`, sizeBytes: f.size });
      } else {
        rejected.push(f.filename);
        await unlink(path).catch(() => undefined);
      }
    }

    if (!accepted.length && rejected.length) {
      throw new BadRequestException(
        'That file is not a real image. Re-save it as JPG or PNG and try again.',
      );
    }

    return { files: accepted, rejectedCount: rejected.length };
  }
}
