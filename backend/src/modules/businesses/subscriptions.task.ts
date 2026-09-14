import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BusinessTier } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from '../auth/sms.service';

/**
 * Paid placement has to stop when payment stops.
 *
 * Without this, `setTier` wrote an expiry date that nothing ever read, so a
 * business that paid for one month kept premium ranking and route-corridor
 * targeting permanently. That is the platform's entire revenue model leaking.
 */
@Injectable()
export class SubscriptionsTask {
  private readonly logger = new Logger(SubscriptionsTask.name);

  constructor(private prisma: PrismaService, private sms: SmsService) {}

  /** 02:15 Kathmandu time is comfortably outside traffic on Nepali routes. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'subscriptions', timeZone: 'Asia/Kathmandu' })
  async nightly() {
    const warned = await this.warnExpiringSoon();
    const lapsed = await this.downgradeLapsed();
    this.logger.log(`Subscriptions: ${warned} warned, ${lapsed} downgraded.`);
    return { warned, lapsed };
  }

  /** Seven days' notice, so renewal is a decision rather than a surprise. */
  async warnExpiringSoon() {
    const from = new Date();
    const to = new Date(Date.now() + 7 * 86_400_000);

    const due = await this.prisma.business.findMany({
      where: {
        tier: { not: BusinessTier.FREE },
        isActive: true,
        subscriptionEndsAt: { gte: from, lte: to },
      },
      select: {
        id: true, name: true, subscriptionEndsAt: true,
        owner: { select: { phone: true } },
      },
    });

    for (const b of due) {
      if (!b.owner?.phone) continue;
      const days = Math.max(
        1, Math.ceil((b.subscriptionEndsAt.getTime() - Date.now()) / 86_400_000),
      );
      await this.sms.send(
        b.owner.phone,
        `Your Bato listing for ${b.name} ends in ${days} day${days === 1 ? '' : 's'}. ` +
        `Renew to keep your placement on the highway routes.`,
      );
    }
    return due.length;
  }

  /**
   * Downgrade to FREE and withdraw route targeting, which is a paid-only
   * feature. Each change is written to SubscriptionEvent so a billing
   * dispute can be answered from the record.
   */
  async downgradeLapsed() {
    const lapsed = await this.prisma.business.findMany({
      where: {
        tier: { not: BusinessTier.FREE },
        subscriptionEndsAt: { lt: new Date() },
      },
      select: {
        id: true, name: true, tier: true, subscriptionEndsAt: true,
        owner: { select: { phone: true } },
      },
    });

    for (const b of lapsed) {
      await this.prisma.$transaction(async (tx) => {
        await tx.business.update({
          where: { id: b.id },
          data: { tier: BusinessTier.FREE },
        });

        // Route targeting is a paid feature and must not survive the downgrade.
        await tx.businessRouteTarget.deleteMany({ where: { businessId: b.id } });

        await tx.subscriptionEvent.create({
          data: {
            businessId: b.id,
            fromTier: b.tier,
            toTier: BusinessTier.FREE,
            reason: 'EXPIRED',
            actorId: null,
            note: `Subscription ended ${b.subscriptionEndsAt.toISOString().slice(0, 10)}; ` +
                  `route targeting withdrawn.`,
          },
        });
      });

      if (b.owner?.phone) {
        await this.sms.send(
          b.owner.phone,
          `Your Bato listing for ${b.name} has moved to the free plan. ` +
          `It is still visible, but no longer promoted on route pages.`,
        );
      }

      this.logger.log(`Downgraded ${b.name} from ${b.tier} to FREE.`);
    }

    return lapsed.length;
  }
}
