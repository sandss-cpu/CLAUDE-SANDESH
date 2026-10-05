import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ktmToday } from '../../common/utils/ktm-period';
import { normalisePlate } from '../fleet/fleet.util';
import { ImportFormDto } from './dto/finance.dto';
import { FinanceAccessService } from './finance-access.service';
import { LOCK_AFTER_MS } from './income.service';
import { parseCsv } from './import/csv';
import { adapterFor, FIELDS, ImportMapping, ImportRow, mapRows } from './import/mapping';
import { readXlsx, XlsxError } from './import/xlsx';
import { formatPaisa } from './money';

export const MAX_IMPORT_ROWS = 5000;
const UNDO_WINDOW_MS = 24 * 3_600_000;

export interface UploadedSheet { buffer: Buffer; originalname: string; size: number }

type RowStatus = 'ok' | 'duplicate' | 'invalid';

/**
 * Income from a portal's CSV or XLSX export. Nothing is saved until the preview has been
 * seen: every row is checked, its bus found by registration number, and any settlement
 * reference already entered for the source (or repeated in the file) marked a duplicate,
 * so importing the same file twice adds nothing. An import can be undone for 24 hours.
 */
@Injectable()
export class IncomeImportService {
  constructor(private prisma: PrismaService, private access: FinanceAccessService, private audit: AuditService) {}

  private table(file: UploadedSheet | undefined): { format: 'csv' | 'xlsx'; table: string[][] } {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a CSV or Excel (.xlsx) file to import.');
    const isZip = file.buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    try {
      if (isZip) return { format: 'xlsx', table: readXlsx(file.buffer) };
    } catch (e) {
      if (e instanceof XlsxError) throw new BadRequestException(e.message);
      throw e;
    }
    if (/\.xls$/i.test(file.originalname)) throw new BadRequestException('Old .xls files cannot be read. Save it as .xlsx or CSV and try again.');
    const text = file.buffer.toString('utf8');
    if (text.includes('\u0000')) throw new BadRequestException('This file is not a spreadsheet. Export a CSV or .xlsx from the portal.');
    return { format: 'csv', table: parseCsv(text) };
  }

  private mappingFrom(raw: string | undefined, saved: unknown, headers: string[]): ImportMapping {
    let m: Partial<ImportMapping> | null = null;
    if (raw) {
      try { m = JSON.parse(raw); } catch { throw new BadRequestException('The column choices could not be read. Choose them again.'); }
    } else if (saved && typeof saved === 'object') {
      m = saved as Partial<ImportMapping>;
    }
    const base = adapterFor(headers).suggest(headers);
    const columns = m?.columns && typeof m.columns === 'object' ? m.columns : base.columns ?? {};
    const clean: ImportMapping['columns'] = {};
    for (const f of FIELDS) {
      const name = (columns as Record<string, unknown>)[f];
      if (typeof name === 'string' && name.length <= 120) clean[f] = name;
    }
    return {
      columns: clean,
      dateOrder: m?.dateOrder && ['DMY', 'MDY', 'YMD'].includes(m.dateOrder) ? m.dateOrder : base.dateOrder ?? 'DMY',
      calendar: m?.calendar === 'BS' ? 'BS' : 'AD',
      vehicleId: typeof m?.vehicleId === 'string' ? m.vehicleId : null,
    };
  }

  /** Reads, maps and checks the file against the company's buses and existing entries. */
  private async prepare(operatorId: string, file: UploadedSheet | undefined, form: ImportFormDto, userId: string) {
    const { operator } = await this.access.company(operatorId, userId, 'ENTER');
    const source = await this.prisma.incomeSource.findFirst({ where: { id: form.sourceId, operatorId } });
    if (!source) throw new NotFoundException('Income source not found');
    const { format, table } = this.table(file);
    if (table.length < 2) throw new BadRequestException('The file has no rows under its header.');
    if (table.length - 1 > MAX_IMPORT_ROWS) throw new BadRequestException(`Import up to ${MAX_IMPORT_ROWS} rows at a time. Split the file by month.`);
    const headers = table[0].map((h) => h.trim());
    const mapping = this.mappingFrom(form.mapping, source.importMapping, headers);

    const buses = await this.prisma.vehicle.findMany({ where: { operatorId }, select: { id: true, plateNo: true, plateKey: true, isActive: true } });
    if (mapping.vehicleId && !buses.some((b) => b.id === mapping.vehicleId)) throw new BadRequestException('Choose one of this company’s buses.');
    const byPlate = new Map(buses.map((b) => [b.plateKey, b]));
    const { rows, missing } = mapRows(table, mapping);

    const refs = [...new Set(rows.map((r) => r.reference).filter(Boolean))] as string[];
    const taken = new Set((await this.prisma.incomeEntry.findMany({
      where: { sourceId: source.id, deletedAt: null, reference: { in: refs } }, select: { reference: true },
    })).map((e) => e.reference));
    const today = ktmToday();

    const checked = rows.map((r: ImportRow) => {
      const errors = [...r.errors];
      const bus = mapping.vehicleId ? buses.find((b) => b.id === mapping.vehicleId) : r.plate ? byPlate.get(normalisePlate(r.plate)) : undefined;
      if (r.plate && !mapping.vehicleId && !bus) errors.push(`No bus ${r.plate} in this company`);
      if (r.date && r.date > today) errors.push('The date is in the future');
      const duplicate = r.duplicateInFile || (!!r.reference && taken.has(r.reference));
      const status: RowStatus = errors.length ? 'invalid' : duplicate ? 'duplicate' : 'ok';
      return { ...r, errors, vehicleId: bus?.id ?? null, busPlate: bus?.plateNo ?? null, status, duplicateOf: duplicate ? (r.duplicateInFile ? 'file' : 'saved') : null };
    });
    const ok = checked.filter((r) => r.status === 'ok');
    return {
      operator, source, format, headers, mapping, missing, rows: checked,
      counts: {
        rows: checked.length, ok: ok.length,
        duplicates: checked.filter((r) => r.status === 'duplicate').length,
        invalid: checked.filter((r) => r.status === 'invalid').length,
        netPaisa: ok.reduce((n, r) => n + (r.netPaisa ?? 0), 0),
      },
    };
  }

  async preview(operatorId: string, file: UploadedSheet | undefined, form: ImportFormDto, userId: string) {
    const p = await this.prepare(operatorId, file, form, userId);
    const adapter = adapterFor(p.headers);
    return {
      source: { id: p.source.id, name: p.source.name }, format: p.format, headers: p.headers,
      adapter: { id: adapter.id, label: adapter.label }, mapping: p.mapping, missing: p.missing,
      counts: p.counts,
      // Enough to judge the file by; the commit re-reads the whole of it.
      rows: p.rows.slice(0, 300),
    };
  }

  async commit(operatorId: string, file: UploadedSheet | undefined, form: ImportFormDto, userId: string, ip?: string) {
    const p = await this.prepare(operatorId, file, form, userId);
    if (p.missing.length) throw new BadRequestException(`Choose the column for: ${p.missing.join(', ')}.`);
    const ok = p.rows.filter((r) => r.status === 'ok');
    if (!ok.length) throw new BadRequestException('Nothing to import: every row is a duplicate or has a problem.');
    const lockedAt = new Date(Date.now() + LOCK_AFTER_MS);

    const result = await this.prisma.$transaction(async (tx) => {
      const imp = await tx.incomeImport.create({
        data: {
          operatorId, sourceId: p.source.id, filename: (file!.originalname || 'import').slice(0, 200), format: p.format,
          rows: p.counts.rows, created: 0, duplicates: p.counts.duplicates, invalid: p.counts.invalid,
          mapping: p.mapping as unknown as Prisma.InputJsonValue, createdById: userId,
        },
      });
      // ON CONFLICT DO NOTHING: a reference saved by someone else a moment ago is skipped, not an error.
      const { count } = await tx.incomeEntry.createMany({
        skipDuplicates: true,
        data: ok.map((r) => ({
          operatorId, vehicleId: r.vehicleId!, date: new Date(`${r.date}T00:00:00Z`), sourceId: p.source.id,
          ticketsSold: r.tickets, seatsSold: r.seats, grossPaisa: r.grossPaisa!, feesPaisa: r.feesPaisa, netPaisa: r.netPaisa!,
          reference: r.reference, note: r.note, importId: imp.id, createdById: userId, lockedAt,
        })),
      });
      const updated = await tx.incomeImport.update({
        where: { id: imp.id }, data: { created: count, duplicates: p.counts.duplicates + (ok.length - count) },
      });
      // Next time this source's file is opened, its columns are already chosen.
      await tx.incomeSource.update({ where: { id: p.source.id }, data: { importMapping: p.mapping as unknown as Prisma.InputJsonValue } });
      await this.audit.record({
        actorId: userId, action: 'income.import', entityType: 'IncomeImport', entityId: imp.id, operatorId, ip,
        summary: `Imported ${count} ${count === 1 ? 'row' : 'rows'} of ${p.source.name} income (${formatPaisa(p.counts.netPaisa)} net) from ${updated.filename}; ${updated.duplicates} duplicates and ${updated.invalid} problem rows skipped`,
      }, tx);
      return updated;
    });
    return this.importView(result);
  }

  private importView(i: { id: string; filename: string; format: string; rows: number; created: number; duplicates: number; invalid: number; createdAt: Date; undoneAt: Date | null; sourceId: string }) {
    return {
      ...i,
      undoableUntil: i.undoneAt ? null : new Date(i.createdAt.getTime() + UNDO_WINDOW_MS),
      canUndo: !i.undoneAt && Date.now() < i.createdAt.getTime() + UNDO_WINDOW_MS,
    };
  }

  async list(operatorId: string, userId: string) {
    await this.access.company(operatorId, userId, 'ENTER');
    const rows = await this.prisma.incomeImport.findMany({
      where: { operatorId }, orderBy: { createdAt: 'desc' }, take: 30,
      include: { source: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...this.importView(r), source: r.source.name }));
  }

  async undo(importId: string, userId: string, ip?: string) {
    const imp = await this.prisma.incomeImport.findUnique({ where: { id: importId } });
    if (!imp) throw new NotFoundException('Import not found');
    await this.access.company(imp.operatorId, userId, 'ENTER').catch((e) => {
      throw e instanceof NotFoundException ? new NotFoundException('Import not found') : e;
    });
    if (imp.undoneAt) throw new ConflictException('This import was already undone.');
    if (Date.now() >= imp.createdAt.getTime() + UNDO_WINDOW_MS) {
      throw new ConflictException('Imports can be undone for 24 hours. Delete wrong entries one by one on the daily sheet instead.');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.incomeEntry.updateMany({
        where: { importId, deletedAt: null }, data: { deletedAt: new Date(), deletedById: userId },
      });
      const updated = await tx.incomeImport.update({ where: { id: importId }, data: { undoneAt: new Date(), undoneById: userId } });
      await this.audit.record({
        actorId: userId, action: 'income.import.undo', entityType: 'IncomeImport', entityId: importId, operatorId: imp.operatorId, ip,
        summary: `Undid the import of ${imp.filename}: ${count} ${count === 1 ? 'entry' : 'entries'} removed`,
      }, tx);
      return { ...updated, removed: count };
    });
    return { ...this.importView(result), removed: result.removed };
  }
}
