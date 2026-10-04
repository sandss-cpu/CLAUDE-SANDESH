import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QrKind } from '@prisma/client';
import { join } from 'path';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { profileCode } from './fleet.util';

export type StickerFormat = 'pdf' | 'png' | 'svg';
export type StickerSize = 'a6' | 'seat';

/** Points per millimetre. */
const MM = 72 / 25.4;
const SIZES: Record<StickerSize, { w: number; h: number; qr: number }> = {
  /** A6, for a window or the wall by the door. */
  a6: { w: 105 * MM, h: 148 * MM, qr: 74 * MM },
  /** The back of a seat. */
  seat: { w: 70 * MM, h: 100 * MM, qr: 48 * MM },
};
const INK = '#1C1A2E';
const BRAND = '#5B3FA8';
const ACCENT = '#F4A024';

const CTA_EN = 'Scan to read Batoma on this journey';
const CTA_NE = 'यो यात्रामा बटोमा पढ्न स्क्यान गर्नुहोस्';
const FONTS = join(__dirname, '../../../assets/fonts');

interface Sticker {
  qrId: string;
  code: string;
  url: string;
  plateNo: string;
  label: string | null;
  operatorId: string;
}

/**
 * The bus's sticker: its one permanent QR, which opens the magazine for that bus, with an
 * English and a Nepali call to action and the plate and short code in small print for
 * support. PNG and SVG are the code alone, for a sign maker; PDFs are print-ready.
 *
 * Access is checked by the callers (owner portal or admin); this only draws and records.
 */
@Injectable()
export class StickersService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private audit: AuditService,
  ) {}

  /** The permanent link a sticker carries. Never change the /b/ path once stickers are printed. */
  shortUrl(code: string) {
    const base = (this.config.get<string>('SHORT_LINK_BASE') || this.config.get<string>('PUBLIC_WEB_URL') || 'http://localhost:5173')
      .replace(/\/$/, '');
    return `${base}/b/${code}`;
  }

  /** The bus's active code, made now if it has none (a bus restored from the archive, say). */
  async ensureBusCode(vehicleId: string) {
    const bus = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true, operatorId: true, routeId: true } });
    if (!bus) throw new NotFoundException('Bus not found');
    const existing = await this.prisma.qrCode.findFirst({ where: { vehicleId, kind: QrKind.BUS, isActive: true } });
    if (existing) return existing;
    try {
      return await this.prisma.qrCode.create({
        data: { shortCode: profileCode(), operatorId: bus.operatorId, vehicleId, routeId: bus.routeId, kind: QrKind.BUS, placement: 'BUS_PROFILE' },
      });
    } catch {
      // Another request made it first (qr_one_active_bus_code); use theirs.
      return this.prisma.qrCode.findFirstOrThrow({ where: { vehicleId, kind: QrKind.BUS, isActive: true } });
    }
  }

  async forBus(vehicleId: string): Promise<Sticker> {
    const bus = await this.prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { plateNo: true, label: true, operatorId: true } });
    if (!bus) throw new NotFoundException('Bus not found');
    const qr = await this.ensureBusCode(vehicleId);
    return { qrId: qr.id, code: qr.shortCode, url: this.shortUrl(qr.shortCode), plateNo: bus.plateNo, label: bus.label, operatorId: bus.operatorId };
  }

  /** One file for one bus, recorded in the print history. */
  async busFile(vehicleId: string, format: StickerFormat, size: StickerSize, actorId: string) {
    const sticker = await this.forBus(vehicleId);
    const name = `batoma-${sticker.plateNo.replace(/[^\p{L}\p{N}]+/gu, '-')}-${sticker.code}`;
    let body: Buffer;
    let contentType: string;
    let filename: string;
    if (format === 'svg') {
      body = Buffer.from(await QRCode.toString(sticker.url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: INK, light: '#FFFFFF' } }));
      contentType = 'image/svg+xml';
      filename = `${name}.svg`;
    } else if (format === 'png') {
      body = await QRCode.toBuffer(sticker.url, { type: 'png', errorCorrectionLevel: 'M', margin: 4, width: 1200, color: { dark: INK, light: '#FFFFFF' } });
      contentType = 'image/png';
      filename = `${name}.png`;
    } else {
      body = await this.pdf([sticker], size, false);
      contentType = 'application/pdf';
      filename = `${name}-${size === 'seat' ? 'seat-back' : 'a6'}.pdf`;
    }
    const printFormat = format === 'pdf' ? (size === 'seat' ? 'PDF_SEAT' : 'PDF_A6') : format.toUpperCase();
    await this.record([sticker], printFormat, actorId);
    return { body, contentType, filename };
  }

  /** Every active bus's sticker, four A6 stickers to an A4 sheet (or eight seat-backs). */
  async fleetSheet(operatorId: string, size: StickerSize, actorId: string) {
    const buses = await this.prisma.vehicle.findMany({
      where: { operatorId, isActive: true }, orderBy: { plateNo: 'asc' }, select: { id: true },
    });
    if (!buses.length) throw new NotFoundException('This company has no active buses.');
    const stickers: Sticker[] = [];
    for (const b of buses) stickers.push(await this.forBus(b.id));
    const body = await this.pdf(stickers, size, true);
    await this.record(stickers, 'SHEET_A6', actorId);
    await this.audit.record({
      actorId, action: 'qr.print-sheet', entityType: 'Operator', entityId: operatorId, operatorId,
      summary: `Printed stickers for ${stickers.length} ${stickers.length === 1 ? 'bus' : 'buses'}`,
    });
    return { body, contentType: 'application/pdf', filename: `batoma-stickers-${size === 'seat' ? 'seat-back' : 'a6'}.pdf` };
  }

  async history(vehicleId: string) {
    const prints = await this.prisma.qrPrint.findMany({
      where: { qrCode: { vehicleId } }, orderBy: { createdAt: 'desc' }, take: 20,
      select: { format: true, createdAt: true, printedById: true, qrCode: { select: { shortCode: true, isActive: true } } },
    });
    const ids = [...new Set(prints.map((p) => p.printedById).filter(Boolean))] as string[];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return prints.map((p) => ({
      format: p.format, at: p.createdAt, by: p.printedById ? names.get(p.printedById) ?? null : null,
      code: p.qrCode.shortCode, current: p.qrCode.isActive,
    }));
  }

  // ================= drawing =================

  private async record(stickers: Sticker[], format: string, actorId: string) {
    await this.prisma.qrPrint.createMany({
      data: stickers.map((s) => ({ qrCodeId: s.qrId, operatorId: s.operatorId, format, printedById: actorId })),
    });
  }

  private pdf(stickers: Sticker[], size: StickerSize, sheet: boolean): Promise<Buffer> {
    const spec = SIZES[size];
    // A4 sheets lay stickers out in a grid with cut lines; single stickers are their own page.
    const page = sheet ? { w: 210 * MM, h: 297 * MM } : { w: spec.w, h: spec.h };
    const cols = sheet ? Math.floor(page.w / spec.w) : 1;
    const rows = sheet ? Math.floor(page.h / spec.h) : 1;
    const perPage = cols * rows;
    const offX = (page.w - cols * spec.w) / 2;
    const offY = (page.h - rows * spec.h) / 2;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: [page.w, page.h], margin: 0, autoFirstPage: false,
        info: { Title: 'Batoma QR stickers', Author: 'Batoma', Creator: 'Batoma' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.registerFont('en', join(FONTS, 'mukta-latin-400-normal.woff'));
      doc.registerFont('en-bold', join(FONTS, 'mukta-latin-700-normal.woff'));
      doc.registerFont('ne-bold', join(FONTS, 'mukta-devanagari-700-normal.woff'));

      stickers.forEach((s, i) => {
        if (i % perPage === 0) doc.addPage();
        const slot = i % perPage;
        const x = offX + (slot % cols) * spec.w;
        const y = offY + Math.floor(slot / cols) * spec.h;
        this.drawSticker(doc, s, x, y, spec, size);
        if (sheet) {
          doc.save().lineWidth(0.4).dash(3, { space: 3 }).strokeColor('#BBBBBB').rect(x, y, spec.w, spec.h).stroke().restore();
        }
      });
      doc.end();
    });
  }

  private drawSticker(doc: PDFKit.PDFDocument, s: Sticker, x: number, y: number, spec: { w: number; h: number; qr: number }, size: StickerSize) {
    const pad = (size === 'seat' ? 4 : 6) * MM;
    const band = (size === 'seat' ? 11 : 15) * MM;
    const inner = spec.w - 2 * pad;

    // Brand band: Batoma, and the prayer-flag colours as one thin line.
    doc.save().rect(x, y, spec.w, band).fill(BRAND).restore();
    doc.font('en-bold').fontSize(size === 'seat' ? 15 : 20).fillColor('#FFFFFF')
      .text('Batoma', x, y + band / 2 - (size === 'seat' ? 10 : 13), { width: spec.w, align: 'center' });
    const flags = ['#2F6FD0', '#FDFAF3', '#E8455F', '#3E9B4F', ACCENT];
    flags.forEach((c, i) => doc.save().rect(x + (i * spec.w) / 5, y + band, spec.w / 5, 1.6 * MM).fill(c).restore());

    // The code itself, drawn as squares so it stays sharp at any print size.
    const qr = QRCode.create(s.url, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const quiet = 2;
    const cell = spec.qr / (n + quiet * 2);
    const qx = x + (spec.w - spec.qr) / 2;
    const qy = y + band + (size === 'seat' ? 5 : 7) * MM;
    doc.save().rect(qx, qy, spec.qr, spec.qr).fill('#FFFFFF').restore();
    doc.save().fillColor(INK);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.modules.get(r, c)) doc.rect(qx + (c + quiet) * cell, qy + (r + quiet) * cell, cell + 0.05, cell + 0.05);
      }
    }
    doc.fill().restore();

    // English and Nepali, each in its own font: the Devanagari face has no Latin letters.
    let ty = qy + spec.qr + (size === 'seat' ? 3 : 5) * MM;
    doc.font('en-bold').fontSize(size === 'seat' ? 10.5 : 14).fillColor(INK)
      .text(CTA_EN, x + pad, ty, { width: inner, align: 'center' });
    ty = doc.y + 1.5 * MM;
    doc.font('ne-bold').fontSize(size === 'seat' ? 10.5 : 14).fillColor(BRAND)
      .text(CTA_NE, x + pad, ty, { width: inner, align: 'center' });

    // Small print, for whoever answers the phone when a sticker is reported.
    const small = size === 'seat' ? 6.5 : 8;
    doc.font('en').fontSize(small).fillColor('#5A5568')
      .text(`${s.plateNo}  ·  code ${s.code}`, x + pad, y + spec.h - pad - small * 2.6, { width: inner, align: 'center' })
      .text(s.url.replace(/^https?:\/\//, ''), { width: inner, align: 'center' });
  }
}
