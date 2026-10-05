import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PackageStatus, Prisma, Role, SubscriberStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import PDFDocument from 'pdfkit';
import { AuditService } from '../../common/audit/audit.service';
import { mixed, registerMukta } from '../../common/pdf/mixed-text';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SitePurgeService } from '../../common/site-purge/site-purge.service';
import { formatBs, kathmanduDay } from '../../common/utils/bs-date';
import { MailService } from '../auth/mail.service';
import { csvLine } from '../finance/import/csv';
import { CONTACT_TYPES, checkMonth, DayCount, partnerReport, REPORT_COLUMNS } from './partner-report';
import { ListQueryDto, NewsletterDto, PackageDto, SiteEnquiryDto, SiteLeadDto, UpdatePackageDto } from './site.dto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const PAGE = 30;

interface Actor { id: string; role: Role }

/**
 * What the public website needs from the API: enquiries to partners and to Batoma, the
 * newsletter, public audience figures; and, around it, the partner report, partner
 * packages and the enquiry inbox.
 */
@Injectable()
export class SiteService {
  private audienceCache: { at: number; data: unknown } | null = null;

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private audit: AuditService,
    private config: ConfigService,
    private purge: SitePurgeService,
  ) {}

  private siteUrl(path: string) {
    return `${(this.config.get<string>('SITE_URL') ?? 'http://localhost:4000').replace(/\/$/, '')}${path}`;
  }

  // ================= forms from the website =================

  async lead(dto: SiteLeadDto) {
    // A bot filled the hidden field: answer as if it worked, record nothing.
    if (dto.website) return { sent: true };
    const business = await this.prisma.business.findFirst({
      where: { slug: dto.businessSlug, isActive: true, verifiedAt: { not: null } },
      select: { id: true, name: true, owner: { select: { email: true, name: true } } },
    });
    if (!business) throw new NotFoundException('That partner is not listed any more.');
    await this.prisma.businessLead.create({
      data: { businessId: business.id, type: 'ENQUIRY', channel: 'SITE', name: dto.name, contact: dto.contact, message: dto.message },
    });
    if (business.owner?.email) {
      const text = `${dto.name} sent ${business.name} an enquiry through the Batoma website.\n\nReply to: ${dto.contact}\n\n${dto.message}\n\nYour enquiries are also in the business area of the Batoma app.`;
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1C1A2E">
        <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#5B3FA8;margin:0">Batoma</p>
        <h1 style="font-size:22px">New enquiry for ${escHtml(business.name)}</h1>
        <p><strong>${escHtml(dto.name)}</strong> · reply to <strong>${escHtml(dto.contact)}</strong></p>
        <p style="white-space:pre-wrap;border-left:4px solid #F4A024;padding-left:12px">${escHtml(dto.message)}</p>
        <p style="color:#5A5568;font-size:13px">Your enquiries are also in the business area of the Batoma app.</p></div>`;
      await this.mail.send(business.owner.email, `New enquiry from ${dto.name} via Batoma`, text, html);
    }
    return { sent: true };
  }

  async enquiry(dto: SiteEnquiryDto, ip: string) {
    if (dto.website) return { sent: true };
    const row = await this.prisma.siteEnquiry.create({
      data: { kind: dto.kind, name: dto.name, contact: dto.contact, organisation: dto.organisation || null, message: dto.message, ipHash: this.audit.hashIp(ip) },
    });
    const inbox = this.config.get<string>('ADMIN_INBOX');
    if (inbox) {
      const what = dto.kind === 'ADVERTISE' ? 'Advertising enquiry' : 'Message';
      await this.mail.send(inbox, `${what} from ${dto.name}${dto.organisation ? ` (${dto.organisation})` : ''}`,
        `${dto.name}${dto.organisation ? `, ${dto.organisation}` : ''}\nReply to: ${dto.contact}\n\n${dto.message}\n\nEnquiry ${row.id} is in the control panel.`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px">${what}</h1>
          <p><strong>${escHtml(dto.name)}</strong>${dto.organisation ? `, ${escHtml(dto.organisation)}` : ''} · ${escHtml(dto.contact)}</p>
          <p style="white-space:pre-wrap">${escHtml(dto.message)}</p></div>`);
    }
    return { sent: true };
  }

  /** The same answer whether or not the address is already on the list. */
  async subscribe(dto: NewsletterDto, ip: string) {
    const generic = { sent: true, message: 'Check your inbox and confirm, and the next issue will come to you.' };
    if (dto.website) return generic;
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.newsletterSubscriber.findUnique({ where: { email } });
    if (existing?.status === SubscriberStatus.CONFIRMED) return generic;
    const token = randomBytes(24).toString('base64url');
    await this.prisma.newsletterSubscriber.upsert({
      where: { email },
      create: { email, confirmTokenHash: sha256(token), unsubscribeToken: randomBytes(24).toString('base64url'), source: dto.source ?? null, ipHash: this.audit.hashIp(ip) },
      update: { status: SubscriberStatus.PENDING, confirmTokenHash: sha256(token), unsubscribedAt: null },
    });
    const { text, html } = this.mail.linkEmail({
      heading: 'Confirm your Batoma newsletter',
      intro: 'Tap the button to start getting new stories, road guides and partner deals from Batoma. If you did not ask for this, ignore this email and nothing will be sent.',
      cta: 'Confirm', url: this.siteUrl(`/newsletter/confirm?token=${token}`),
      footer: 'You can unsubscribe from any newsletter with one click.',
    });
    await this.mail.send(email, 'Confirm your Batoma newsletter', text, html);
    return generic;
  }

  async confirm(token: string) {
    const sub = await this.prisma.newsletterSubscriber.findFirst({ where: { confirmTokenHash: sha256(token), status: SubscriberStatus.PENDING } });
    if (!sub) throw new BadRequestException('This link has expired or was already used.');
    await this.prisma.newsletterSubscriber.update({ where: { id: sub.id }, data: { status: SubscriberStatus.CONFIRMED, confirmedAt: new Date(), confirmTokenHash: null } });
    return { confirmed: true, unsubscribeToken: sub.unsubscribeToken };
  }

  async unsubscribe(token: string) {
    const sub = await this.prisma.newsletterSubscriber.findUnique({ where: { unsubscribeToken: token } });
    if (sub && sub.status !== SubscriberStatus.UNSUBSCRIBED) {
      await this.prisma.newsletterSubscriber.update({ where: { id: sub.id }, data: { status: SubscriberStatus.UNSUBSCRIBED, unsubscribedAt: new Date() } });
    }
    // The same answer for an unknown token: it reveals nothing about who is subscribed.
    return { unsubscribed: true };
  }

  /** Public figures for "Advertise with Batoma", worked out at most every ten minutes. */
  async audience() {
    if (this.audienceCache && Date.now() - this.audienceCache.at < 600_000) return this.audienceCache.data;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [scans, readers, pageViews, buses, routes, partners, articles] = await Promise.all([
      this.prisma.scanEvent.count({ where: { scannedAt: { gte: since } } }),
      this.prisma.$queryRaw<Array<{ n: bigint }>>`SELECT count(DISTINCT "sessionId") AS n FROM scan_events WHERE "scannedAt" >= ${since}`,
      this.prisma.siteEvent.count({ where: { type: 'PAGE_VIEW', createdAt: { gte: since } } }),
      this.prisma.vehicle.count({ where: { isActive: true, operator: { verification: 'VERIFIED' } } }),
      this.prisma.route.count({ where: { vehicles: { some: { isActive: true } } } }),
      this.prisma.business.count({ where: { isActive: true, verifiedAt: { not: null } } }),
      this.prisma.article.count({ where: { status: 'PUBLISHED' } }),
    ]);
    const data = { scansLast30Days: scans, readersLast30Days: Number(readers[0]?.n ?? 0), websiteViewsLast30Days: pageViews, buses, routes, partners, articles };
    this.audienceCache = { at: Date.now(), data };
    return data;
  }

  // ================= partners: their enquiries and their report =================

  private async ownBusiness(businessId: string, actor: Actor) {
    const b = await this.prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, slug: true, ownerId: true } });
    // Someone else's listing is "not found", so ids cannot be probed.
    if (!b || (actor.role !== Role.ADMIN && b.ownerId !== actor.id)) throw new NotFoundException('Business not found');
    return b;
  }

  async leads(businessId: string, actor: Actor, page = 1) {
    await this.ownBusiness(businessId, actor);
    const where = { businessId, type: 'ENQUIRY' as const };
    const [items, total] = await Promise.all([
      this.prisma.businessLead.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE,
        select: { id: true, name: true, contact: true, message: true, channel: true, createdAt: true },
      }),
      this.prisma.businessLead.count({ where }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
  }

  async report(businessId: string, actor: Actor, month?: string) {
    const b = await this.ownBusiness(businessId, actor);
    let m: string;
    try { m = checkMonth(month, kathmanduDay(new Date())); } catch (e) { throw new BadRequestException((e as Error).message); }
    const from = new Date(`${m}-01T00:00:00+05:45`);
    const [y, mo] = m.split('-').map(Number);
    const to = new Date(`${new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7)}-01T00:00:00+05:45`);
    const day = Prisma.sql`to_char(("createdAt" + interval '345 minutes')::date, 'YYYY-MM-DD')`;
    const [site, leads, issued, redeemed] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: string; type: string; n: bigint }>>`
        SELECT ${day} AS day, type::text AS type, count(*) AS n FROM site_events
        WHERE "businessId" = ${businessId} AND "createdAt" >= ${from} AND "createdAt" < ${to} AND type IN ('IMPRESSION', 'CLICK')
        GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ day: string; type: string; n: bigint }>>`
        SELECT ${day} AS day, type::text AS type, count(*) AS n FROM business_leads
        WHERE "businessId" = ${businessId} AND "createdAt" >= ${from} AND "createdAt" < ${to} GROUP BY 1, 2`,
      this.prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
        SELECT to_char((r."issuedAt" + interval '345 minutes')::date, 'YYYY-MM-DD') AS day, count(*) AS n
        FROM coupon_redemptions r JOIN coupons c ON c.id = r."couponId"
        WHERE c."businessId" = ${businessId} AND r."issuedAt" >= ${from} AND r."issuedAt" < ${to} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ day: string; n: bigint }>>`
        SELECT to_char((r."redeemedAt" + interval '345 minutes')::date, 'YYYY-MM-DD') AS day, count(*) AS n
        FROM coupon_redemptions r JOIN coupons c ON c.id = r."couponId"
        WHERE c."businessId" = ${businessId} AND r."redeemedAt" >= ${from} AND r."redeemedAt" < ${to} GROUP BY 1`,
    ]);
    const counts: DayCount[] = [
      ...site.map((r) => ({ day: r.day, key: r.type === 'CLICK' ? 'clicks' : 'impressions', n: Number(r.n) })),
      ...leads.map((r) => ({
        day: r.day, n: Number(r.n),
        key: r.type === 'ENQUIRY' ? 'enquiries' : r.type === 'PROFILE_VIEW' ? 'profileViews' : CONTACT_TYPES.includes(r.type) ? 'contactTaps' : 'other',
      })),
      ...issued.map((r) => ({ day: r.day, key: 'couponsIssued', n: Number(r.n) })),
      ...redeemed.map((r) => ({ day: r.day, key: 'couponsRedeemed', n: Number(r.n) })),
    ];
    return { business: { id: b.id, name: b.name, slug: b.slug }, monthBs: formatBs(`${m}-15`).replace(/^\d+ /, ''), ...partnerReport(m, counts) };
  }

  async reportCsv(businessId: string, actor: Actor, month?: string) {
    const r = await this.report(businessId, actor, month);
    const lines = [
      csvLine([`${r.business.name}: Batoma partner report, ${r.month}`]),
      csvLine(['Day', ...REPORT_COLUMNS.map(([, l]) => l)]),
      ...r.days.map((d) => csvLine([d.day, ...REPORT_COLUMNS.map(([k]) => d[k])])),
      csvLine(['Total', ...REPORT_COLUMNS.map(([k]) => r.totals[k])]),
      csvLine(['Website click-through rate', r.ctr == null ? '' : `${(r.ctr * 100).toFixed(2)}%`]),
    ];
    return { body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`), contentType: 'text/csv; charset=utf-8', filename: `batoma-report-${r.business.slug}-${r.month}.csv` };
  }

  async reportPdf(businessId: string, actor: Actor, month?: string) {
    const r = await this.report(businessId, actor, month);
    const body = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 44, bottom: 40, left: 44, right: 44 }, info: { Title: `${r.business.name}: ${r.month}`, Creator: 'Batoma' } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      registerMukta(doc);
      const left = doc.page.margins.left;
      const width = doc.page.width - left * 2;
      doc.rect(0, 0, doc.page.width, 6).fill('#5B3FA8');
      mixed(doc, r.business.name, { bold: true, size: 18, x: left, y: 26, width });
      mixed(doc, `Batoma partner report · ${r.month} (${r.monthBs} BS)`, { size: 11, color: '#5A5568', width });
      const boxes: Array<[string, string]> = [
        ['Website impressions', String(r.totals.impressions)], ['Website clicks', String(r.totals.clicks)],
        ['Click-through rate', r.ctr == null ? '—' : `${(r.ctr * 100).toFixed(1)}%`], ['Enquiries', String(r.totals.enquiries)],
        ['Coupons redeemed', String(r.totals.couponsRedeemed)],
      ];
      const bw = (width - 4 * 6) / 5;
      const by = doc.y + 10;
      boxes.forEach(([l, v], i) => {
        const x = left + i * (bw + 6);
        doc.roundedRect(x, by, bw, 44, 5).lineWidth(0.6).strokeColor('#E4DED0').stroke();
        mixed(doc, l, { size: 7.5, color: '#5A5568', x: x + 6, y: by + 5, width: bw - 12 });
        mixed(doc, v, { bold: true, size: 14, x: x + 6, y: by + 18, width: bw - 12 });
      });
      doc.y = by + 56;
      const cols = ['Day', 'Impr.', 'Clicks', 'Profile views', 'Contact taps', 'Enquiries', 'Coupons claimed', 'Redeemed'];
      const keys = ['impressions', 'clicks', 'profileViews', 'contactTaps', 'enquiries', 'couponsIssued', 'couponsRedeemed'] as const;
      const cw = width / cols.length;
      const row = (values: string[], bold = false) => {
        const y = doc.y;
        values.forEach((v, i) => mixed(doc, v, { size: 8.5, bold, x: left + i * cw, y, width: cw - 4, align: i ? 'right' : 'left' }));
        doc.y = y + 13.5;
      };
      row(cols, true);
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor('#E4DED0').stroke();
      doc.y += 3;
      for (const d of r.days) row([d.day, ...keys.map((k) => String(d[k] || ''))]);
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.5).strokeColor('#E4DED0').stroke();
      doc.y += 3;
      row(['Total', ...keys.map((k) => String(r.totals[k]))], true);
      doc.y += 8;
      mixed(doc, 'Impressions and clicks are counted on the Batoma website, once per visit for clicks and without cookies. Profile views and contact taps come from the Batoma app; enquiries from both. Days are Nepal time.',
        { size: 8, color: '#5A5568', x: left, y: doc.y, width });
      doc.end();
    });
    return { body, contentType: 'application/pdf', filename: `batoma-report-${r.business.slug}-${r.month}.pdf` };
  }

  // ================= the control panel =================

  async packages(q: ListQueryDto) {
    return this.prisma.partnerPackage.findMany({
      where: { ...(q.status ? { status: q.status as PackageStatus } : {}), ...(q.businessId ? { businessId: q.businessId } : {}) },
      include: { business: { select: { id: true, name: true, slug: true } } },
      orderBy: [{ status: 'asc' }, { startsAt: 'desc' }], take: 200,
    });
  }

  private dates(starts?: string, ends?: string, before?: { startsAt: Date; endsAt: Date }) {
    const startsAt = starts ? new Date(starts) : before?.startsAt;
    const endsAt = ends ? new Date(ends) : before?.endsAt;
    if (!startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new BadRequestException('Give the start and end dates.');
    if (endsAt <= startsAt) throw new BadRequestException('A package must end after it starts.');
    return { startsAt, endsAt };
  }

  async createPackage(dto: PackageDto, actorId: string, ip?: string) {
    const business = await this.prisma.business.findUnique({ where: { id: dto.businessId }, select: { name: true } });
    if (!business) throw new NotFoundException('Business not found');
    const pkg = await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerPackage.create({
        data: { businessId: dto.businessId, kind: dto.kind, ...this.dates(dto.startsAt, dto.endsAt), pricePaisa: dto.pricePaisa ?? null, status: dto.status ?? 'PROPOSED', notes: dto.notes || null, createdById: actorId },
      });
      await this.audit.record({ actorId, action: 'package.create', entityType: 'PartnerPackage', entityId: row.id, ip, summary: `${business.name}: ${row.kind.toLowerCase().replace(/_/g, ' ')} package, ${row.status.toLowerCase()}`, after: row }, tx);
      return row;
    });
    this.purge.purge('package');
    return pkg;
  }

  async updatePackage(id: string, dto: UpdatePackageDto, actorId: string, ip?: string) {
    const before = await this.prisma.partnerPackage.findUnique({ where: { id }, include: { business: { select: { name: true } } } });
    if (!before) throw new NotFoundException('Package not found');
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.partnerPackage.update({
        where: { id },
        data: {
          ...(dto.kind ? { kind: dto.kind } : {}), ...(dto.startsAt || dto.endsAt ? this.dates(dto.startsAt, dto.endsAt, before) : {}),
          ...(dto.pricePaisa !== undefined ? { pricePaisa: dto.pricePaisa } : {}), ...(dto.status ? { status: dto.status } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        },
      });
      await this.audit.record({ actorId, action: 'package.update', entityType: 'PartnerPackage', entityId: id, ip, summary: `${before.business.name}: package changed`, before, after: row }, tx);
      return row;
    });
    this.purge.purge('package');
    return updated;
  }

  async enquiries(q: ListQueryDto) {
    const page = q.page ?? 1;
    const where = q.status ? { status: q.status as 'NEW' | 'HANDLED' } : {};
    const [items, total] = await Promise.all([
      this.prisma.siteEnquiry.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * PAGE, take: PAGE }),
      this.prisma.siteEnquiry.count({ where }),
    ]);
    return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
  }

  async setEnquiryStatus(id: string, status: 'NEW' | 'HANDLED', actorId: string, ip?: string) {
    const e = await this.prisma.siteEnquiry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Enquiry not found');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.siteEnquiry.update({ where: { id }, data: { status, handledById: status === 'HANDLED' ? actorId : null, handledAt: status === 'HANDLED' ? new Date() : null } });
      await this.audit.record({ actorId, action: 'enquiry.status', entityType: 'SiteEnquiry', entityId: id, ip, summary: `Enquiry from ${e.name} marked ${status.toLowerCase()}` }, tx);
      return row;
    });
  }

  async newsletterSummary() {
    const groups = await this.prisma.newsletterSubscriber.groupBy({ by: ['status'], _count: true });
    return Object.fromEntries(['PENDING', 'CONFIRMED', 'UNSUBSCRIBED'].map((s) => [s.toLowerCase(), groups.find((g) => g.status === s)?._count ?? 0]));
  }

  /** Confirmed addresses only, for sending the newsletter; who exported them is audited. */
  async newsletterCsv(actorId: string, ip?: string) {
    const rows = await this.prisma.newsletterSubscriber.findMany({ where: { status: 'CONFIRMED' }, orderBy: { confirmedAt: 'asc' }, select: { email: true, confirmedAt: true, unsubscribeToken: true } });
    await this.audit.record({ actorId, action: 'newsletter.export', entityType: 'NewsletterSubscriber', ip, summary: `Exported ${rows.length} confirmed newsletter addresses` });
    const lines = [csvLine(['Email', 'Confirmed', 'Unsubscribe link']), ...rows.map((r) => csvLine([r.email, r.confirmedAt?.toISOString().slice(0, 10) ?? '', this.siteUrl(`/newsletter/unsubscribe?token=${r.unsubscribeToken}`)]))];
    return { body: Buffer.from(`﻿${lines.join('\r\n')}\r\n`), contentType: 'text/csv; charset=utf-8', filename: 'batoma-newsletter.csv' };
  }
}
