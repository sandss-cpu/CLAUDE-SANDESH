import {
  BadRequestException, Controller, Post, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { NotAnImageError, publicVariants } from '../../common/media/images';

const MAX_MB = Number(process.env.MAX_UPLOAD_MB ?? 8);

@Controller('media')
export class MediaController {
  constructor(private config: ConfigService) {}

  /**
   * Public pictures (covers, listings, posts). Each is decoded and drawn again as WebP
   * at 480, 960 and up to 1600 pixels wide (common/media/images.ts): metadata such as a
   * phone's GPS position is gone, and anything that is not really an image is refused.
   * The original bytes are never stored, and the original filename is never used.
   *
   * Local disk in development. In production point MEDIA_BASE_URL at storage on a
   * separate origin: serving user uploads from the API's own domain would turn any
   * content-sniffing slip into same-origin script execution.
   */
  @Throttle({ default: { limit: 30, ttl: 600_000 } })
  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MB * 1024 * 1024, files: 10, fields: 5 },
    }),
  )
  async upload(@UploadedFiles() files: Array<{ buffer: Buffer; size: number }>) {
    const base = this.config.get('MEDIA_BASE_URL');
    const dir = process.env.UPLOAD_DIR || './uploads';
    await mkdir(dir, { recursive: true });
    const accepted: Array<{ url: string; sizeBytes: number; width: number; height: number; srcset: Array<{ url: string; width: number }> }> = [];
    let rejectedCount = 0;

    for (const f of files ?? []) {
      try {
        const { width, height, variants } = await publicVariants(f.buffer);
        const id = randomUUID();
        for (const v of variants) await writeFile(join(dir, `${id}-${v.width}.webp`), v.buffer);
        const srcset = variants.map((v) => ({ url: `${base}/${id}-${v.width}.webp`, width: v.width }));
        const largest = variants[variants.length - 1];
        accepted.push({ url: srcset[srcset.length - 1].url, sizeBytes: largest.buffer.length, width, height, srcset });
      } catch (e) {
        if (!(e instanceof NotAnImageError)) throw e;
        rejectedCount += 1;
      }
    }

    if (!accepted.length && rejectedCount) {
      throw new BadRequestException('That file is not a real image. Re-save it as JPG or PNG and try again.');
    }
    return { files: accepted, rejectedCount };
  }
}
