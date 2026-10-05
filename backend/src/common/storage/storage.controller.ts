import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { contentTypeOf, StorageService } from './storage.service';

/**
 * Serves a private file to whoever holds an unexpired signed link (disk storage only;
 * with S3 the link goes straight to the bucket). The link is the permission: the API
 * checked who was asking when it handed the link out.
 */
@Controller('files')
export class StorageController {
  constructor(private storage: StorageService) {}

  @Public()
  @Get(':key')
  async file(@Param('key') key: string, @Query('exp') exp: string, @Query('sig') sig: string, @Res() res: Response) {
    const body = await this.storage.readSigned(key, exp, sig);
    res.setHeader('Content-Type', contentTypeOf(key));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Even a file that slipped past every check cannot run script on this origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.send(body);
  }
}
