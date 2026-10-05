import {
  BadRequestException, Controller, Post, UploadedFiles, UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { randomUUID } from 'crypto';
import { NotAnImageError, publicVariants } from '../../common/media/images';
import { StorageService } from '../../common/storage/storage.service';

const MAX_MB = Number(process.env.MAX_UPLOAD_MB ?? 8);

@Controller('media')
export class MediaController {
  constructor(private config: ConfigService, private storage: StorageService) {}

  /**
   * Public pictures (covers, listings, posts). Each is decoded and drawn again as WebP
   * at 480, 960 and up to 1600 pixels wide (common/media/images.ts): metadata such as a
   * phone's GPS position is gone, and anything that is not really an image is refused.
   * The original bytes are never stored, and the original filename is never used.
   *
   * A public bucket in production (S3_PUBLIC_BUCKET, served from MEDIA_BASE_URL on its own
   * origin: user uploads on the API's domain would turn any content-sniffing slip into
   * same-origin script execution); the local uploads folder in development.
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
    const accepted: Array<{ url: string; sizeBytes: number; width: number; height: number; srcset: Array<{ url: string; width: number }> }> = [];
    let rejectedCount = 0;

    for (const f of files ?? []) {
      try {
        const { width, height, variants } = await publicVariants(f.buffer);
        const id = randomUUID();
        for (const v of variants) await this.storage.putPublic(`${id}-${v.width}.webp`, v.buffer);
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
