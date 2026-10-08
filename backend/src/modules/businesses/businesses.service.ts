import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessTier, ModerationStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isOwnMediaUrl } from '../../common/utils/media.util';
import { normaliseEmail } from '../auth/dto/auth.dto';
import { AdminListingDto, CreateAdminListingDto } from './dto/admin-listing.dto';
import { AuditService } from '../../common/audit/audit.service';
import { paged } from '../../common/dto/pagination.dto';
import { couponCode, uniqueSlug } from '../../common/utils/slug.util';
import { haversineKm } from '../../common/utils/geo.util';
import {
  BusinessQueryDto, CreateBusinessDto, CreateCouponDto, LeadDto, ReviewDto,
  TargetRoutesDto, UpdateBusinessDto, VerifyBusinessDto,
} from './dto/business.dto';

const TIER_RANK: Record<BusinessTier, number> = {
  PREMIUM: 4, FEATURED: 3, VERIFIED: 2, FREE: 1,
};

@Injectable()
export class BusinessesService {
  constructor(private prisma: PrismaService, private audit: AuditService, private config: ConfigService) {}

  /** Listing photos are uploads made through Batoma, never pictures from elsewhere on the web. */
  private assertMedia(urls: string[] | null | undefined) {
    const base = this.config.get<string>('MEDIA_BASE_URL') ?? '';
    if ((urls ?? []).some((u) => !isOwnMediaUrl(u, base))) throw new BadRequestException('Upload the photos through Batoma.');
  }

  // ---------- discovery ----------

  async list(q: BusinessQueryDto) {
    const where: Prisma.BusinessWhereInput = {
      isActive: true,
      ...(q.category ? { category: q.category } : {}),
      ...(q.district ? { district: { equals: q.district, mode: 'insensitive' } } : {}),
      ...(q.tier ? { tier: q.tier } : {}),
      ...(q.destinationSlug ? { destination: { slug: q.destinationSlug } } : {}),
      ...(q.routeId ? { routeTargets: { some: { routeId: q.routeId } } } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };

    /**
     * When a radius is supplied the filter has to happen in SQL.
     *
     * Paginating first and then filtering by distance in JavaScript meant a
     * page of twenty could return three results while the total claimed
     * hundreds — the count and the page disagreed, and later pages skipped
     * businesses entirely.
     *
     * A bounding box narrows the rows using the lat/lng indexes, then the
     * exact haversine runs on that much smaller set. Both the page and the
     * count use the same predicate, so they agree.
     */
    if (q.lat != null && q.lng != null && q.radiusKm != null) {
      const degLat = q.radiusKm / 111;
      const degLng = q.radiusKm / (111 * Math.cos((q.lat * Math.PI) / 180) || 1);

      const boxed: Prisma.BusinessWhereInput = {
        ...where,
        latitude: { gte: q.lat - degLat, lte: q.lat + degLat },
        longitude: { gte: q.lng - degLng, lte: q.lng + degLng },
      };

      const candidates = await this.prisma.business.findMany({
        where: boxed,
        select: {
          id: true, slug: true, name: true, category: true, tier: true, district: true,
          priceRange: true, latitude: true, longitude: true, verifiedAt: true, phone: true,
          photos: { take: 1, select: { url: true } },
          _count: { select: { reviews: true } },
        },
        take: 2000,
      });

      const within = candidates
        .map((b) => ({
          ...b,
          distanceKm: +haversineKm(q.lat!, q.lng!, b.latitude!, b.longitude!).toFixed(2),
        }))
        .filter((b) => b.distanceKm <= q.radiusKm!)
        .sort((a, b) => {
          const t = TIER_RANK[b.tier] - TIER_RANK[a.tier];
          return t !== 0 ? t : a.distanceKm - b.distanceKm;
        });

      return paged(within.slice(q.skip, q.skip + q.take), within.length, q);
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        select: {
          id: true, slug: true, name: true, category: true, tier: true, district: true,
          priceRange: true, latitude: true, longitude: true, verifiedAt: true, phone: true,
          photos: { take: 1, select: { url: true } },
          _count: { select: { reviews: true } },
        },
        orderBy: [{ tier: 'desc' }, { verifiedAt: 'desc' }, { name: 'asc' }],
        skip: q.skip, take: q.take,
      }),
      this.prisma.business.count({ where }),
    ]);

    // No radius: paid tier decides ordering, distance is informational only.
    const items =
      q.lat != null && q.lng != null
        ? rows.map((b) => ({
            ...b,
            distanceKm:
              b.latitude != null && b.longitude != null
                ? +haversineKm(q.lat!, q.lng!, b.latitude, b.longitude).toFixed(2)
                : null,
          }))
        : rows;

    return paged(items, total, q);
  }

  /**
   * A public listing. Fields are listed rather than spread from the row, because the
   * row also holds the owner's account id and the admin's private verification note;
   * a switched-off listing is not public at all.
   */
  async findOne(slug: string) {
    const b = await this.prisma.business.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true, slug: true, name: true, category: true, description: true,
        district: true, address: true, latitude: true, longitude: true,
        phone: true, whatsapp: true, viber: true, website: true, priceRange: true,
        amenities: true, tier: true, verifiedAt: true, createdAt: true,
        photos: { orderBy: { sortOrder: 'asc' } },
        destination: { select: { slug: true, name: true, district: true } },
        coupons: {
          where: { isActive: true, validTo: { gt: new Date() } },
          select: {
            id: true, title: true, description: true, discountLabel: true,
            validTo: true, perUserLimit: true,
          },
        },
        reviews: {
          where: { moderation: ModerationStatus.APPROVED },
          select: {
            id: true, rating: true, body: true, createdAt: true, reply: true,
            redemptionId: true,
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!b) throw new NotFoundException('Business not found');

    const agg = await this.prisma.review.aggregate({
      where: { businessId: b.id, moderation: ModerationStatus.APPROVED },
      _avg: { rating: true }, _count: { rating: true },
    });

    return {
      ...b,
      rating: {
        average: agg._avg.rating ? +agg._avg.rating.toFixed(2) : null,
        count: agg._count.rating,
        // Reviews backed by a redeemed coupon are the trustworthy subset.
        verifiedCount: b.reviews.filter((r) => r.redemptionId).length,
      },
    };
  }

  // ---------- listing management ----------

  // Batoma's admins add and edit listings in the control panel (Website → Listings). The
  // partner area finds a listing by its owner account, so linking the owner by email is
  // what lets the business manage it themselves; with no owner, Batoma manages it.

  async adminGet(id: string) {
    const b = await this.prisma.business.findUnique({
      where: { id },
      include: {
        photos: { orderBy: { sortOrder: 'asc' }, select: { url: true } },
        owner: { select: { id: true, name: true, email: true } },
        destination: { select: { id: true, name: true } },
      },
    });
    if (!b) throw new NotFoundException('Listing not found');
    return b;
  }

  async adminCreate(dto: CreateAdminListingDto, actorId: string, ip?: string) {
    const { photos, owner, ...data } = await this.adminData(dto);
    const slug = await uniqueSlug(dto.name, async (s) => !!(await this.prisma.business.findUnique({ where: { slug: s }, select: { id: true } })));
    const verified = dto.verify;
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.business.create({
        data: {
          ...data, slug, ownerId: owner?.id ?? null,
          tier: verified ? BusinessTier.VERIFIED : BusinessTier.FREE,
          verifiedAt: verified ? new Date() : null, verifiedBy: verified ? actorId : null,
          verificationNote: verified ? dto.verificationNote ?? null : null,
          photos: photos.length ? { create: photos.map((url, i) => ({ url, sortOrder: i })) } : undefined,
        },
        include: { photos: true },
      });
      await this.audit.record({
        actorId, ip, action: 'business.create', entityType: 'Business', entityId: b.id,
        summary: `Added the listing ${b.name}${verified ? ', verified' : ', waiting for verification'}${owner ? `, owned by ${owner.email}` : ', managed by Batoma'}`,
        after: { ...b, photos: photos.length },
      }, tx);
      return b;
    });
  }

  async adminUpdate(id: string, dto: AdminListingDto, actorId: string, ip?: string) {
    const before = await this.prisma.business.findUnique({
      where: { id }, include: { owner: { select: { email: true } }, photos: { select: { url: true } } },
    });
    if (!before) throw new NotFoundException('Listing not found');
    // Photos it already has may stay, wherever they came from; new ones must be Batoma uploads.
    const { photos, owner, ...data } = await this.adminData(dto, before.photos.map((p) => p.url));
    return this.prisma.$transaction(async (tx) => {
      await tx.businessPhoto.deleteMany({ where: { businessId: id } });
      const b = await tx.business.update({
        where: { id },
        data: {
          ...data, ownerId: owner?.id ?? null,
          photos: photos.length ? { create: photos.map((url, i) => ({ url, sortOrder: i })) } : undefined,
        },
        include: { photos: true },
      });
      const ownerChange = (before.owner?.email ?? null) !== (owner?.email ?? null)
        ? `; owner ${owner ? `now ${owner.email}` : 'removed: Batoma manages it'}` : '';
      const { owner: _o, photos: beforePhotos, ...beforeRow } = before;
      await this.audit.record({
        actorId, ip, action: 'business.update', entityType: 'Business', entityId: id,
        summary: `Edited the listing ${b.name}${ownerChange}`, before: { ...beforeRow, photos: beforePhotos.length }, after: { ...b, photos: photos.length },
      }, tx);
      return b;
    });
  }

  /** Checks a listing form: photos uploaded through Batoma, a real place, both map numbers or neither, a real owner. */
  private async adminData(dto: AdminListingDto, kept: string[] = []) {
    const photos = dto.photoUrls ?? [];
    this.assertMedia(photos.filter((u) => !kept.includes(u)));
    if ((dto.latitude == null) !== (dto.longitude == null)) {
      throw new BadRequestException('Give both the latitude and the longitude for the map pin, or neither.');
    }
    if (dto.destinationId && !(await this.prisma.destination.findUnique({ where: { id: dto.destinationId }, select: { id: true } }))) {
      throw new BadRequestException('That place no longer exists. Choose another.');
    }
    let owner: { id: string; email: string } | null = null;
    if (dto.ownerEmail) {
      const user = await this.prisma.user.findUnique({
        where: { email: normaliseEmail(dto.ownerEmail) }, select: { id: true, email: true, role: true, isSuspended: true },
      });
      if (!user) throw new BadRequestException('No Batoma account uses that email. Ask the owner to create one (it is free), then link it here.');
      if (user.isSuspended) throw new BadRequestException('That account is suspended, so it cannot manage a listing.');
      if (user.role === Role.ADMIN || user.role === Role.EDITOR || user.role === Role.MODERATOR) {
        throw new BadRequestException("That is a Batoma staff account. Link the business's own account, or leave the owner empty.");
      }
      owner = { id: user.id, email: user.email! };
    }
    return {
      photos, owner,
      name: dto.name, category: dto.category, description: dto.description ?? null,
      destinationId: dto.destinationId ?? null, district: dto.district ?? null, address: dto.address ?? null,
      latitude: dto.latitude ?? null, longitude: dto.longitude ?? null,
      phone: dto.phone ?? null, whatsapp: dto.whatsapp ?? null, viber: dto.viber ?? null, website: dto.website ?? null,
      priceRange: dto.priceRange ?? null,
      amenities: (dto.amenities ?? []).map((a) => a.trim()).filter(Boolean),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
  }

  async create(dto: CreateBusinessDto, ownerId: string) {
    this.assertMedia(dto.photoUrls);
    const slug = await uniqueSlug(dto.name, async (s) =>
      !!(await this.prisma.business.findUnique({ where: { slug: s }, select: { id: true } })),
    );

    return this.prisma.business.create({
      data: {
        slug, ownerId,
        name: dto.name, category: dto.category, description: dto.description,
        destinationId: dto.destinationId, district: dto.district, address: dto.address,
        latitude: dto.latitude, longitude: dto.longitude,
        phone: dto.phone, whatsapp: dto.whatsapp, viber: dto.viber, website: dto.website,
        priceRange: dto.priceRange, amenities: dto.amenities ?? [],
        photos: dto.photoUrls?.length
          ? { create: dto.photoUrls.slice(0, 3).map((url, i) => ({ url, sortOrder: i })) }
          : undefined,
      },
      include: { photos: true },
    });
  }

  private async assertOwner(businessId: string, userId: string, role: Role) {
    const b = await this.prisma.business.findUnique({
      where: { id: businessId }, select: { ownerId: true },
    });
    if (!b) throw new NotFoundException('Business not found');
    if (role !== Role.ADMIN && b.ownerId !== userId) {
      throw new ForbiddenException('This is not your listing');
    }
  }

  async update(id: string, dto: UpdateBusinessDto, userId: string, role: Role) {
    await this.assertOwner(id, userId, role);
    this.assertMedia(dto.photoUrls);

    if (dto.photoUrls) {
      await this.prisma.businessPhoto.deleteMany({ where: { businessId: id } });
      const limit = role === Role.ADMIN ? 20 : 3; // free tier caps photos at 3
      await this.prisma.businessPhoto.createMany({
        data: dto.photoUrls.slice(0, limit).map((url, i) => ({ businessId: id, url, sortOrder: i })),
      });
    }

    return this.prisma.business.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        category: dto.category ?? undefined,
        description: dto.description,
        district: dto.district, address: dto.address,
        latitude: dto.latitude, longitude: dto.longitude,
        phone: dto.phone, whatsapp: dto.whatsapp, viber: dto.viber, website: dto.website,
        priceRange: dto.priceRange,
        amenities: dto.amenities,
      },
      include: { photos: true },
    });
  }

  /**
   * Verification is manual and deliberate. One fraudulent listing that harms
   * a tourist is an existential reputational event for a platform like this.
   */
  async verify(id: string, dto: VerifyBusinessDto, adminId: string, ip?: string) {
    const before = await this.prisma.business.findUnique({ where: { id }, select: { name: true, tier: true, verifiedAt: true } });
    if (!before) throw new NotFoundException('Business not found');
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id },
        data: {
          verifiedAt: new Date(),
          verifiedBy: adminId,
          verificationNote: dto.verificationNote,
          tier: dto.tier ?? BusinessTier.VERIFIED,
        },
      });
      await this.audit.record({
        actorId: adminId, action: 'business.verify', entityType: 'Business', entityId: id, ip,
        summary: `${before.name} verified (${row.tier.toLowerCase()}): ${dto.verificationNote}`,
        before, after: { tier: row.tier, verifiedAt: row.verifiedAt },
      }, tx);
      return row;
    });
  }

  /**
   * Extends from the current expiry when still active, so renewing early
   * does not cost the business the days it already paid for.
   */
  async setTier(id: string, tier: BusinessTier, months = 1, actorId?: string, ip?: string) {
    const current = await this.prisma.business.findUnique({
      where: { id }, select: { name: true, tier: true, subscriptionEndsAt: true },
    });
    if (!current) throw new NotFoundException('Business not found');

    const now = Date.now();
    const from =
      current.subscriptionEndsAt && current.subscriptionEndsAt.getTime() > now
        ? current.subscriptionEndsAt.getTime()
        : now;

    const endsAt =
      tier === BusinessTier.FREE ? null : new Date(from + months * 30 * 86_400_000);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.business.update({
        where: { id },
        data: { tier, subscriptionEndsAt: endsAt },
      });

      if (tier === BusinessTier.FREE) {
        await tx.businessRouteTarget.deleteMany({ where: { businessId: id } });
      }

      await tx.subscriptionEvent.create({
        data: {
          businessId: id,
          fromTier: current.tier,
          toTier: tier,
          reason:
            tier === BusinessTier.FREE ? 'CANCELLED'
            : current.tier === tier ? 'RENEWED' : 'UPGRADED',
          actorId: actorId ?? null,
          note: endsAt ? `${months} month(s), through ${endsAt.toISOString().slice(0, 10)}` : null,
        },
      });
      await this.audit.record({
        actorId: actorId ?? null, action: 'business.tier', entityType: 'Business', entityId: id, ip,
        summary: `${current.name}: ${current.tier.toLowerCase()} → ${tier.toLowerCase()}${endsAt ? `, through ${endsAt.toISOString().slice(0, 10)}` : ''}`,
        before: { tier: current.tier, subscriptionEndsAt: current.subscriptionEndsAt }, after: { tier, subscriptionEndsAt: endsAt },
      }, tx);

      return updated;
    });
  }

  /** Route-corridor targeting: appear to readers scanning on this highway. */
  async targetRoutes(id: string, dto: TargetRoutesDto, userId: string, role: Role) {
    await this.assertOwner(id, userId, role);
    const b = await this.prisma.business.findUnique({ where: { id }, select: { tier: true } });
    if (b.tier === BusinessTier.FREE) {
      throw new BadRequestException('Route targeting requires a paid tier');
    }

    await this.prisma.businessRouteTarget.deleteMany({ where: { businessId: id } });
    if (dto.routeIds.length) {
      await this.prisma.businessRouteTarget.createMany({
        data: dto.routeIds.map((routeId) => ({ businessId: id, routeId })),
        skipDuplicates: true,
      });
    }
    return { targeted: dto.routeIds.length };
  }

  /**
   * Listings awaiting manual verification. The verify() action existed but
   * there was no way to find anything to verify, which left the whole
   * workflow unreachable.
   */
  async verificationQueue(q: BusinessQueryDto) {
    const where: Prisma.BusinessWhereInput = {
      verifiedAt: null,
      isActive: true,
      ...(q.category ? { category: q.category } : {}),
      ...(q.district ? { district: { equals: q.district, mode: 'insensitive' } } : {}),
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.business.findMany({
        where,
        select: {
          id: true, slug: true, name: true, category: true, district: true,
          address: true, phone: true, website: true, createdAt: true,
          latitude: true, longitude: true, description: true,
          owner: { select: { id: true, name: true, phone: true, createdAt: true } },
          photos: { select: { url: true } },
          _count: { select: { photos: true, reviews: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: q.skip, take: q.take,
      }),
      this.prisma.business.count({ where }),
    ]);

    const now = Date.now();
    return paged(
      items.map((b) => ({
        ...b,
        waitingDays: Math.round((now - b.createdAt.getTime()) / 86_400_000),
        // A listing with no photo and no phone is almost never worth a site visit.
        completeEnoughToReview: b._count.photos > 0 && !!b.phone,
      })),
      total, q,
    );
  }

  myBusinesses(ownerId: string) {
    return this.prisma.business.findMany({
      where: { ownerId },
      select: {
        id: true, slug: true, name: true, category: true, tier: true,
        verifiedAt: true, subscriptionEndsAt: true, isActive: true,
        _count: { select: { leads: true, reviews: true, coupons: true } },
      },
    });
  }

  // ---------- coupons: the lead-attribution proof ----------

  async createCoupon(businessId: string, dto: CreateCouponDto, userId: string, role: Role) {
    await this.assertOwner(businessId, userId, role);
    return this.prisma.coupon.create({
      data: {
        businessId,
        title: dto.title,
        description: dto.description,
        discountLabel: dto.discountLabel,
        validTo: new Date(dto.validTo),
        maxRedemptions: dto.maxRedemptions,
        perUserLimit: dto.perUserLimit ?? 1,
      },
    });
  }

  async endCoupon(couponId: string, userId: string, role: Role) {
    const c = await this.prisma.coupon.findUnique({ where: { id: couponId }, select: { id: true, business: { select: { ownerId: true } } } });
    // Someone else's deal is "not found", so ids cannot be probed.
    if (!c || (role !== Role.ADMIN && c.business.ownerId !== userId)) throw new NotFoundException('Deal not found');
    return this.prisma.coupon.update({ where: { id: couponId }, data: { isActive: false }, select: { id: true, isActive: true } });
  }

  /**
   * Traveller claims a code. This is the row that proves the platform sent them.
   *
   * The whole claim runs inside a transaction that takes a row lock on the
   * coupon first. Checking the count and then inserting without one let two
   * simultaneous requests both pass the limit check, so `maxRedemptions` was
   * a suggestion rather than a cap — which matters when a business has agreed
   * to honour a fixed number of discounts.
   */
  async claimCoupon(couponId: string, userId: string, routeId?: string) {
    return this.prisma.$transaction(async (tx) => {
      // Serialises concurrent claims on this coupon; other coupons are unaffected.
      //
      // No ::uuid cast: Prisma maps `String @id` to a text column, so casting the
      // parameter asked Postgres for a text = uuid operator, which does not exist
      // (42883). The lock threw, the transaction rolled back, and every claim
      // failed with "Database request failed".
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM coupons WHERE id = ${couponId} FOR UPDATE`;
      if (!locked.length) throw new NotFoundException('Offer not available');

      const coupon = await tx.coupon.findUnique({
        where: { id: couponId },
        include: { _count: { select: { redemptions: true } } },
      });

      const now = new Date();
      if (!coupon.isActive) throw new NotFoundException('Offer not available');
      // validFrom existed on the model but was never enforced, so an offer
      // scheduled for next season was claimable today.
      if (coupon.validFrom > now) {
        throw new BadRequestException(
          `This offer opens on ${coupon.validFrom.toISOString().slice(0, 10)}`,
        );
      }
      if (coupon.validTo < now) throw new BadRequestException('This offer has expired');

      if (coupon.maxRedemptions && coupon._count.redemptions >= coupon.maxRedemptions) {
        throw new BadRequestException('This offer has been fully claimed');
      }

      const mine = await tx.couponRedemption.count({ where: { couponId, userId } });
      if (mine >= coupon.perUserLimit) {
        throw new BadRequestException('You have already claimed this offer');
      }

      return tx.couponRedemption.create({
        data: { couponId, userId, routeId, code: couponCode() },
        include: { coupon: { include: { business: { select: { name: true, phone: true } } } } },
      });
    });
  }

  /** The business marks the code used at the counter. */
  async redeemCoupon(code: string, userId: string, role: Role) {
    const redemption = await this.prisma.couponRedemption.findUnique({
      where: { code },
      include: { coupon: { include: { business: { select: { id: true, ownerId: true, name: true } } } } },
    });
    if (!redemption) throw new NotFoundException('Code not found');
    if (redemption.redeemedAt) throw new BadRequestException('This code has already been used');

    if (role !== Role.ADMIN && redemption.coupon.business.ownerId !== userId) {
      throw new ForbiddenException('This code belongs to another business');
    }

    return this.prisma.couponRedemption.update({
      where: { id: redemption.id },
      data: { redeemedAt: new Date() },
    });
  }

  // ---------- leads & dashboard ----------

  async recordLead(businessId: string, dto: LeadDto, userId?: string) {
    await this.prisma.businessLead.create({
      data: {
        businessId, type: dto.type, userId,
        routeId: dto.routeId, sessionId: dto.sessionId,
      },
    });
    return { recorded: true };
  }

  /**
   * The dashboard that has to convince a hotel to keep paying. Everything here
   * is attribution: where the lead came from and whether it converted.
   */
  async dashboard(businessId: string, userId: string, role: Role, days = 30) {
    await this.assertOwner(businessId, userId, role);
    const since = new Date(Date.now() - days * 86_400_000);

    const [leadsByType, leadsByRoute, coupons, reviewAgg, totalLeads] = await Promise.all([
      this.prisma.businessLead.groupBy({
        by: ['type'],
        where: { businessId, createdAt: { gte: since } },
        _count: { type: true },
      }),
      this.prisma.$queryRaw<Array<{ route: string; leads: bigint }>>`
        SELECT COALESCE(r.name, 'Direct') AS route, COUNT(*)::bigint AS leads
          FROM business_leads bl
     LEFT JOIN routes r ON r.id = bl."routeId"
         WHERE bl."businessId" = ${businessId} AND bl."createdAt" >= ${since}
      GROUP BY r.name
      ORDER BY leads DESC`,
      this.prisma.coupon.findMany({
        where: { businessId },
        select: {
          id: true, title: true, discountLabel: true, validTo: true, isActive: true,
          _count: { select: { redemptions: true } },
          redemptions: { where: { redeemedAt: { not: null } }, select: { id: true } },
        },
      }),
      this.prisma.review.aggregate({
        where: { businessId, moderation: ModerationStatus.APPROVED },
        _avg: { rating: true }, _count: { rating: true },
      }),
      this.prisma.businessLead.count({ where: { businessId, createdAt: { gte: since } } }),
    ]);

    const claimed = coupons.reduce((s, c) => s + c._count.redemptions, 0);
    const redeemed = coupons.reduce((s, c) => s + c.redemptions.length, 0);

    return {
      periodDays: days,
      totalLeads,
      leadsByType: leadsByType.map((l) => ({ type: l.type, count: l._count.type })),
      leadsByRoute: leadsByRoute.map((r) => ({ route: r.route, leads: Number(r.leads) })),
      coupons: coupons.map((c) => ({
        id: c.id, title: c.title, discountLabel: c.discountLabel, validTo: c.validTo, isActive: c.isActive,
        claimed: c._count.redemptions, redeemed: c.redemptions.length,
      })),
      couponSummary: {
        claimed, redeemed,
        conversionRate: claimed ? +((redeemed / claimed) * 100).toFixed(1) : 0,
      },
      rating: {
        average: reviewAgg._avg.rating ? +reviewAgg._avg.rating.toFixed(2) : null,
        count: reviewAgg._count.rating,
      },
    };
  }

  // ---------- reviews ----------

  async review(businessId: string, dto: ReviewDto, userId: string) {
    // A review backed by a redeemed coupon is auto-approved; others queue.
    let verified = false;
    if (dto.redemptionId) {
      const r = await this.prisma.couponRedemption.findFirst({
        where: {
          id: dto.redemptionId, userId,
          redeemedAt: { not: null },
          coupon: { businessId },
        },
      });
      verified = !!r;
    }

    return this.prisma.review.upsert({
      where: { businessId_userId: { businessId, userId } },
      create: {
        businessId, userId, rating: dto.rating, body: dto.body,
        redemptionId: verified ? dto.redemptionId : null,
        moderation: verified ? ModerationStatus.APPROVED : ModerationStatus.PENDING,
      },
      update: {
        rating: dto.rating, body: dto.body,
        moderation: verified ? ModerationStatus.APPROVED : ModerationStatus.PENDING,
      },
    });
  }

  async replyToReview(reviewId: string, reply: string, userId: string, role: Role) {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId }, include: { business: { select: { ownerId: true } } },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (role !== Role.ADMIN && review.business.ownerId !== userId) {
      throw new ForbiddenException('This is not your listing');
    }
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { reply, repliedAt: new Date() },
    });
  }
}
