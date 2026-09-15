import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OperatorVerification, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../auth/mail.service';
import { FleetAccessService } from './fleet-access.service';
import { FleetService, Reminder } from './fleet.service';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Turns due services, expiring documents and licences, and open breakdowns into
 * notifications, then emails each company one digest of what is new. Each
 * reminder has a dedupe key built from its due date and stage, so an owner hears
 * about a service once when it's due soon and once more if it becomes overdue.
 */
@Injectable()
export class FleetRemindersTask {
  private readonly logger = new Logger(FleetRemindersTask.name);

  constructor(
    private prisma: PrismaService,
    private fleet: FleetService,
    private mail: MailService,
    private access: FleetAccessService,
  ) {}

  /** 06:00 Kathmandu: in the inbox before the first buses leave the park. */
  @Cron('0 6 * * *', { name: 'fleet-reminders', timeZone: 'Asia/Kathmandu' })
  async nightly() {
    const result = await this.run();
    this.logger.log(`Fleet reminders: ${result.created} new across ${result.companies} companies, ${result.emailed} emails.`);
  }

  async run() {
    const operators = await this.prisma.operator.findMany({
      where: { isActive: true, verification: { in: [OperatorVerification.VERIFIED, OperatorVerification.PENDING] } },
      select: { id: true, name: true },
    });
    let created = 0;
    let emailed = 0;

    for (const operator of operators) {
      const [buses, drivers] = await Promise.all([
        this.prisma.vehicle.findMany({ where: { operatorId: operator.id, isActive: true }, take: 2000 }),
        this.prisma.driver.findMany({
          where: { operatorId: operator.id, isActive: true }, select: { id: true, name: true, licenceExpiresAt: true },
        }),
      ]);
      const rows = await this.fleet.summarise(buses);
      const due = this.fleet.reminders(rows, drivers).filter((r) => r.severity !== 'low');

      const fresh: Array<Reminder & { notificationId: string }> = [];
      for (const r of due) {
        try {
          const n = await this.prisma.fleetNotification.create({
            data: { operatorId: operator.id, vehicleId: r.busId, kind: r.kind, title: r.title, body: r.detail, dedupeKey: r.key },
          });
          fresh.push({ ...r, notificationId: n.id });
        } catch (e) {
          if ((e as Prisma.PrismaClientKnownRequestError)?.code !== 'P2002') throw e;
        }
      }
      created += fresh.length;
      if (fresh.length && (await this.emailDigest(operator, fresh))) {
        emailed += 1;
        await this.prisma.fleetNotification.updateMany({
          where: { id: { in: fresh.map((f) => f.notificationId) } }, data: { emailedAt: new Date() },
        });
      }
    }
    return { companies: operators.length, created, emailed };
  }

  private async emailDigest(operator: { id: string; name: string }, items: Reminder[]) {
    const members = await this.prisma.operatorAdmin.findMany({
      where: { operatorId: operator.id, user: { emailVerifiedAt: { not: null } } },
      select: { user: { select: { email: true, name: true } } },
    });
    if (!members.length) return false;

    const lines = items.slice(0, 20).map((i) => `• ${i.title} — ${i.detail}`);
    if (items.length > 20) lines.push(`…and ${items.length - 20} more in the portal.`);
    let sent = false;
    for (const { user } of members) {
      const content = this.mail.linkEmail({
        heading: `${items.length} reminder${items.length === 1 ? '' : 's'} for ${escapeHtml(operator.name)}`,
        intro: `Namaste ${escapeHtml(user.name)},<br><br>${lines.map(escapeHtml).join('<br>')}`,
        cta: 'Open the owner portal',
        url: this.access.webUrl('owner.html'),
        footer: 'Bato sends one summary a day, only when something new needs attention.',
      });
      sent = (await this.mail.send(user.email, `Bus reminders for ${operator.name}`, content.text, content.html)) || sent;
    }
    return sent;
  }
}
