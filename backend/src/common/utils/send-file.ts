import type { Response } from 'express';

/** A file, sent as a download rather than wrapped in the usual JSON envelope. */
export function sendFile(res: Response, file: { body: Buffer; contentType: string; filename: string }) {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`);
  // Stickers and reports are private to the company that asked; never keep them in a shared cache.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.body);
}
