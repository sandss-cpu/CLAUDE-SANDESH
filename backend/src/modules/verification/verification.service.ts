import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, VerificationDocKind } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { isPdf, NotAnImageError, reencode } from '../../common/media/images';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { FleetAccessService } from '../fleet/fleet-access.service';

/**
 * Proof that a bus company or a business is who it says: PAN and registration
 * certificates, a bus's bluebook, a route permit, a business licence. Uploaded by the
 * owner, read only by the owner and by Batoma's admins and moderators, who verify.
 *
 * Kept in private storage (never under /uploads), each read through a link that
 * expires in five minutes. Photos are drawn again from their pixels, so a phone's
 * location and other metadata are not kept. PDFs are kept as they are, but refused if
 * they carry scripts, launch actions or attached files, and are only ever downloaded,
 * never opened inside the browser on our origin.
 */

export const DOC_KIND_LABEL: Record<VerificationDocKind, string> = {
  PAN: 'PAN certificate', COMPANY_REGISTRATION: 'Company registration', BLUEBOOK: 'Bluebook',
  ROUTE_PERMIT: 'Route permit', BUSINESS_LICENCE: 'Business licence', OTHER: 'Other document',
};
const MAX_PER_OWNER = 12;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const LINK_SECONDS = 300;

type Owner = { operatorId: string } | { businessId: string };
type Actor = { id: string; role: Role };
const view = (d: { id: string; kind: VerificationDocKind; mimeType: string; sizeBytes: number; createdAt: Date }) => ({
  id: d.id, kind: d.kind, label: DOC_KIND_LABEL[d.kind], mimeType: d.mimeType, sizeBytes: d.sizeBytes, createdAt: d.createdAt,
});

/** A PDF that can run something when opened is not a certificate. */
export function riskyPdf(b: Buffer): boolean {
  const text = b.toString('latin1');
  return /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA)\b/.test(text);
}

@Injectable()
export class VerificationService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
    private fleetAccess: FleetAccessService,
  ) {}

  /** Owners only: a company's owner (not managers or crew), a business's owner. Anyone else: not found. */
  async ownerOf(target: 'company' | 'business', id: string, actor: Actor): Promise<{ owner: Owner; name: string }> {
    if (target === 'company') {
      const { operator } = await this.fleetAccess.company(id, actor.id, 'OWN');
      return { owner: { operatorId: operator.id }, name: operator.name };
    }
    const b = await this.prisma.business.findUnique({ where: { id }, select: { id: true, name: true, ownerId: true } });
    if (!b || b.ownerId !== actor.id) throw new NotFoundException('Business not found');
    return { owner: { businessId: b.id }, name: b.name };
  }

  list(owner: Owner) {
    return this.prisma.verificationDocument.findMany({ where: owner, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map(view));
  }

  async upload(owner: Owner, name: string, kind: VerificationDocKind, file: { buffer: Buffer } | undefined, actor: Actor, ip?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a photo or PDF of the document.');
    if ((await this.prisma.verificationDocument.count({ where: owner })) >= MAX_PER_OWNER) {
      throw new BadRequestException(`At most ${MAX_PER_OWNER} documents. Delete an old one first.`);
    }
    let body: Buffer;
    let ext: 'webp' | 'pdf';
    if (isPdf(file.buffer)) {
      if (file.buffer.length > MAX_PDF_BYTES) throw new BadRequestException('A PDF can be at most 10 MB.');
      if (riskyPdf(file.buffer)) throw new BadRequestException('That PDF contains scripts or attached files. Print it to a new PDF, or send a photo.');
      body = file.buffer; ext = 'pdf';
    } else {
      try { body = (await reencode(file.buffer, 2400)).buffer; ext = 'webp'; } catch (e) {
        if (e instanceof NotAnImageError) throw new BadRequestException('Send a photo (JPG or PNG) or a PDF of the document.');
        throw e;
      }
    }
    const ownerId = 'operatorId' in owner ? owner.operatorId : owner.businessId;
    const key = `verification/${ownerId}/${randomUUID()}.${ext}`;
    await this.storage.put(key, body);
    const doc = await this.prisma.$transaction(async (tx) => {
      const row = await tx.verificationDocument.create({
        data: { ...owner, kind, storageKey: key, mimeType: ext === 'pdf' ? 'application/pdf' : 'image/webp', sizeBytes: body.length, uploadedById: actor.id },
      });
      await this.audit.record({
        actorId: actor.id, action: 'verification.upload', entityType: 'VerificationDocument', entityId: row.id, ip,
        operatorId: 'operatorId' in owner ? owner.operatorId : null, summary: `${name}: ${DOC_KIND_LABEL[kind].toLowerCase()} uploaded`,
      }, tx);
      return row;
    });
    return view(doc);
  }

  async link(owner: Owner, docId: string) {
    const doc = await this.prisma.verificationDocument.findFirst({ where: { id: docId, ...owner } });
    if (!doc) throw new NotFoundException('Document not found');
    return { url: this.storage.signedUrl(doc.storageKey, LINK_SECONDS), expiresInSeconds: LINK_SECONDS };
  }

  async remove(owner: Owner, name: string, docId: string, actor: Actor, ip?: string) {
    const doc = await this.prisma.verificationDocument.findFirst({ where: { id: docId, ...owner } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.verificationDocument.delete({ where: { id: doc.id } });
      await this.audit.record({
        actorId: actor.id, action: 'verification.delete', entityType: 'VerificationDocument', entityId: doc.id, ip,
        operatorId: doc.operatorId, summary: `${name}: ${DOC_KIND_LABEL[doc.kind].toLowerCase()} deleted`,
      }, tx);
    });
    await this.storage.remove(doc.storageKey);
    return { deleted: true };
  }

  // ---------- Batoma staff, verifying ----------

  async adminList(q: { operatorId?: string; businessId?: string }) {
    if (!q.operatorId === !q.businessId) throw new BadRequestException('Give a company or a business.');
    return this.list(q.operatorId ? { operatorId: q.operatorId } : { businessId: q.businessId! });
  }

  /** Every look at a document by staff is in the audit log. */
  async adminLink(docId: string, actor: Actor, ip?: string) {
    const doc = await this.prisma.verificationDocument.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.audit.record({
      actorId: actor.id, action: 'verification.view', entityType: 'VerificationDocument', entityId: doc.id, ip,
      operatorId: doc.operatorId, summary: `Viewed a ${DOC_KIND_LABEL[doc.kind].toLowerCase()} while verifying`,
    });
    return { url: this.storage.signedUrl(doc.storageKey, LINK_SECONDS), expiresInSeconds: LINK_SECONDS };
  }
}
