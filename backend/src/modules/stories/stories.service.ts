import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContentStatus, SubmissionStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { firstSentence } from '../../common/utils/brief';
import { readMinutes, uniqueSlug } from '../../common/utils/slug.util';
import { otpMayBeReturnedInResponse } from '../../config/env.validation';
import { AuthService } from '../auth/auth.service';
import { normaliseEmail } from '../auth/dto/auth.dto';
import { MailService } from '../auth/mail.service';
import { DeclineStoryDto, FeatureStoryDto, SiteStoryDto } from './dto/story.dto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** How long the email link stays good, and how many stories one address may send a day. */
const CONFIRM_HOURS = 72;
const PER_DAY = 5;

/**
 * Stories sent from the website's "Write a trip" page. Sending one makes (or finds) the
 * writer's Batoma account; the story reaches editors only once the email link is followed,
 * which proves the address and stops anyone sending under someone else's name.
 */
@Injectable()
export class StoriesService {
  private readonly log = new Logger(StoriesService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private audit: AuditService,
    private config: ConfigService,
    private auth: AuthService,
  ) {}

  private siteUrl(path: string) {
    return `${(this.config.get<string>('SITE_URL') ?? 'http://localhost:4000').replace(/\/$/, '')}${path}`;
  }

  /** In development with no mail server, links are shown on the page instead of emailed. */
  private get mayEcho() {
    return otpMayBeReturnedInResponse(this.config.get('NODE_ENV'), this.mail.isConfigured);
  }

  /** The same answer whoever sends it, so the form reveals nothing about who has an account. */
  async submit(dto: SiteStoryDto, ip: string) {
    const generic = { sent: true, message: 'Check your inbox: confirm your email and your story goes to our editors.' };
    if (dto.website) return generic;
    const email = normaliseEmail(dto.email);
    const user = (await this.prisma.user.findUnique({ where: { email } }))
      ?? (await this.prisma.user.create({ data: { email, name: dto.name, language: 'EN' } }));
    const today = await this.prisma.storySubmission.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    if (today >= PER_DAY) return generic;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.storySubmission.create({
      data: {
        userId: user.id, title: dto.title, place: dto.place ?? null, body: dto.story,
        confirmTokenHash: sha256(token), confirmBy: new Date(Date.now() + CONFIRM_HOURS * 3_600_000),
        ipHash: this.audit.hashIp(ip),
      },
    });
    const url = this.siteUrl(`/write/confirm?token=${token}`);
    const { text, html } = this.mail.linkEmail({
      heading: 'Send your story to Batoma',
      intro: `Namaste ${dto.name}, thank you for writing “${dto.title}”. Confirm this is your email and it goes to our editors. If you did not write to Batoma, ignore this email and nothing is sent.`,
      cta: 'Send my story', url,
      footer: `This link works for ${CONFIRM_HOURS} hours.`,
    });
    await this.mail.send(email, 'Confirm your story for Batoma', text, html);
    return { ...generic, devLink: this.mayEcho ? url : undefined };
  }

  async confirm(token: string) {
    const sub = await this.prisma.storySubmission.findUnique({ where: { confirmTokenHash: sha256(token) }, include: { user: true } });
    if (!sub || sub.status !== SubmissionStatus.AWAITING_EMAIL || !sub.confirmBy || sub.confirmBy < new Date()) {
      throw new BadRequestException('This link has expired or was already used. You can send your story again from the website.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.storySubmission.update({
        where: { id: sub.id },
        data: { status: SubmissionStatus.SUBMITTED, submittedAt: new Date(), confirmTokenHash: null, confirmBy: null },
      });
      // Following the link proves the inbox, so the account is confirmed too.
      if (!sub.user.emailVerifiedAt) await tx.user.update({ where: { id: sub.userId }, data: { emailVerifiedAt: new Date() } });
      await this.audit.record({
        actorId: sub.userId, action: 'story.submit', entityType: 'StorySubmission', entityId: sub.id,
        summary: `${sub.user.name} sent the story “${sub.title}” from the website`,
      }, tx);
    });

    // A new writer gets an email to choose a password. If that email cannot go now, the
    // story is in all the same, and "Forgot password" on the sign-in page does the same job.
    const needsPassword = !sub.user.passwordHash;
    const passwordLink = needsPassword
      ? await this.auth.sendPasswordSetup(sub.userId).catch((e) => { this.log.warn(`Password email not sent: ${(e as Error).message}`); return undefined; })
      : undefined;

    const inbox = this.config.get<string>('ADMIN_INBOX');
    if (inbox) {
      const where = sub.place ? ` · ${sub.place}` : '';
      await this.mail.send(inbox, `New story for the magazine: ${sub.title}`,
        `${sub.user.name} (${sub.user.email})${where}\n${words(sub.body)} words.\n\nRead it in the control panel, under Story submissions.`,
        `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px"><h1 style="font-size:20px">${escHtml(sub.title)}</h1>
          <p><strong>${escHtml(sub.user.name)}</strong> · ${escHtml(sub.user.email ?? '')}${escHtml(where)} · ${words(sub.body)} words</p>
          <p>Read it in the control panel, under Story submissions.</p></div>`);
    }
    return { confirmed: true, title: sub.title, needsPassword, devPasswordLink: this.mayEcho ? passwordLink : undefined };
  }

  // ======================================================================== editors

  async list(status: SubmissionStatus = SubmissionStatus.SUBMITTED) {
    const [rows, groups] = await Promise.all([
      this.prisma.storySubmission.findMany({
        where: { status },
        orderBy: status === SubmissionStatus.SUBMITTED ? { submittedAt: 'asc' } : { decidedAt: 'desc' },
        take: 200,
        select: {
          id: true, title: true, place: true, status: true, body: true, submittedAt: true, decidedAt: true, editorNote: true,
          user: { select: { name: true, email: true } },
          article: { select: { id: true, slug: true, status: true } },
        },
      }),
      this.prisma.storySubmission.groupBy({ by: ['status'], _count: true }),
    ]);
    const counts = Object.fromEntries(Object.values(SubmissionStatus).map((s) => [s, groups.find((g) => g.status === s)?._count ?? 0]));
    return {
      counts,
      items: rows.map(({ body, ...r }) => ({ ...r, words: words(body), opening: firstSentence(body) })),
    };
  }

  async get(id: string) {
    const sub = await this.prisma.storySubmission.findUnique({
      where: { id },
      select: {
        id: true, title: true, place: true, body: true, status: true, submittedAt: true, decidedAt: true, editorNote: true,
        user: { select: { id: true, name: true, email: true } },
        article: { select: { id: true, slug: true, status: true } },
      },
    });
    if (!sub || sub.status === SubmissionStatus.AWAITING_EMAIL) throw new NotFoundException('Story not found');
    return { ...sub, words: words(sub.body) };
  }

  /**
   * Turns a story into a magazine draft with the writer's byline. The editor then edits
   * it, adds a summary, key points and pictures, and publishes it as any other article.
   */
  async feature(id: string, dto: FeatureStoryDto, actorId: string, ip?: string) {
    const sub = await this.waiting(id);
    if (dto.categoryId && !(await this.prisma.category.findUnique({ where: { id: dto.categoryId }, select: { id: true } }))) {
      throw new BadRequestException('That section no longer exists. Choose another.');
    }
    const slug = await uniqueSlug(sub.title, async (s) => !!(await this.prisma.article.findUnique({ where: { slug: s }, select: { id: true } })));
    const article = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.article.create({
        data: {
          slug, title: sub.title, subtitle: sub.place, summary: firstSentence(sub.body), body: sub.body,
          readMinutes: readMinutes(sub.body), status: ContentStatus.DRAFT, authorId: sub.userId,
          categoryId: dto.categoryId ?? null,
        },
      });
      await tx.storySubmission.update({
        where: { id }, data: { status: SubmissionStatus.FEATURED, articleId: draft.id, decidedAt: new Date(), decidedById: actorId },
      });
      await this.audit.record({
        actorId, ip, action: 'story.feature', entityType: 'StorySubmission', entityId: id,
        summary: `Made “${sub.title}” by ${sub.user.name} into a magazine draft`,
      }, tx);
      return draft;
    });
    const { text, html } = this.mail.linkEmail({
      heading: 'Your story is going into Batoma',
      intro: `Namaste ${sub.user.name}, our editors would like to publish “${sub.title}”. An editor is preparing it now and may write to you about photos or a detail or two. It will carry your name.`,
      cta: 'Read Batoma', url: this.siteUrl('/stories'),
      footer: 'Thank you for writing for Batoma.',
    });
    if (sub.user.email) await this.mail.send(sub.user.email, `Your story “${sub.title}” is going into Batoma`, text, html);
    return { articleId: article.id, slug: article.slug };
  }

  async decline(id: string, dto: DeclineStoryDto, actorId: string, ip?: string) {
    const sub = await this.waiting(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.storySubmission.update({
        where: { id }, data: { status: SubmissionStatus.DECLINED, editorNote: dto.note ?? null, decidedAt: new Date(), decidedById: actorId },
      });
      await this.audit.record({
        actorId, ip, action: 'story.decline', entityType: 'StorySubmission', entityId: id,
        summary: `Declined “${sub.title}” by ${sub.user.name}`,
      }, tx);
    });
    const { text, html } = this.mail.linkEmail({
      heading: 'About your story',
      intro: `Namaste ${sub.user.name}, thank you for sending “${sub.title}”. We are not able to publish it this time.${dto.note ? ` A note from our editor: ${dto.note}` : ''} We would be glad to read your next one.`,
      cta: 'Write another', url: this.siteUrl('/write'),
      footer: 'Thank you for writing for Batoma.',
    });
    if (sub.user.email) await this.mail.send(sub.user.email, `About your story “${sub.title}”`, text, html);
    return { declined: true };
  }

  /** Only a confirmed story still waiting for a decision can be featured or declined. */
  private async waiting(id: string) {
    const sub = await this.prisma.storySubmission.findUnique({ where: { id }, include: { user: { select: { name: true, email: true } } } });
    if (!sub || sub.status === SubmissionStatus.AWAITING_EMAIL) throw new NotFoundException('Story not found');
    if (sub.status !== SubmissionStatus.SUBMITTED) throw new BadRequestException('This story has already been decided.');
    return sub;
  }
}
