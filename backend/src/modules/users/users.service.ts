import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, ModerationStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paged } from '../../common/dto/pagination.dto';
import { isPrivileged } from '../auth/mfa.service';
import { AdminUserQueryDto, SetRoleDto, UpdatePrivacyDto, UpdateProfileDto } from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, phone: true, email: true, avatarUrl: true, bio: true,
        homeDistrict: true, language: true, role: true, hideExactLocation: true,
        publishDelayHours: true, createdAt: true,
        _count: { select: { posts: true, followers: true, following: true, itineraries: true } },
      },
    });
    if (!user) throw new NotFoundException('Account not found');
    return user;
  }

  /** Public traveller profile: posts, districts visited, badges. */
  async publicProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, name: true, avatarUrl: true, bio: true, homeDistrict: true, createdAt: true,
        _count: { select: { followers: true, following: true } },
      },
    });
    if (!user) throw new NotFoundException('Traveller not found');

    const posts = await this.prisma.post.findMany({
      where: {
        authorId: userId,
        status: ContentStatus.PUBLISHED,
        moderation: ModerationStatus.APPROVED,
      },
      select: {
        id: true, title: true, coverImageUrl: true, locationName: true,
        publishedAt: true, isElevated: true,
        destination: { select: { slug: true, name: true, district: true } },
      },
      orderBy: { publishedAt: 'desc' },
      take: 24,
    });

    const districts = [
      ...new Set(posts.map((p) => p.destination?.district).filter(Boolean) as string[]),
    ];

    return {
      ...user,
      posts,
      stats: {
        publishedPosts: posts.length,
        districtsVisited: districts.length,
        elevatedToMagazine: posts.filter((p) => p.isElevated).length,
      },
      districts,
      badges: this.badges(posts.length, districts.length, posts.filter((p) => p.isElevated).length),
    };
  }

  /** Contribution levels (spec Module 2). Cheap to compute, no extra tables. */
  private badges(posts: number, districts: number, elevated: number) {
    const out: Array<{ code: string; label: string }> = [];
    if (posts >= 1) out.push({ code: 'FIRST_POST', label: 'First Story' });
    if (posts >= 10) out.push({ code: 'STORYTELLER', label: 'Storyteller' });
    if (posts >= 50) out.push({ code: 'CHRONICLER', label: 'Chronicler' });
    if (districts >= 5) out.push({ code: 'WANDERER', label: 'Wanderer' });
    if (districts >= 20) out.push({ code: 'DISTRICT_20', label: '20 Districts' });
    if (elevated >= 1) out.push({ code: 'IN_PRINT', label: 'Published in the Magazine' });
    return out;
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: { id: true, name: true, avatarUrl: true, bio: true, homeDistrict: true, language: true },
    });
  }

  updatePrivacy(userId: string, dto: UpdatePrivacyDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: { id: true, hideExactLocation: true, publishDelayHours: true },
    });
  }

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw new BadRequestException('You cannot follow yourself');
    await this.prisma.follow.upsert({
      where: { followerId_followingId: { followerId, followingId } },
      create: { followerId, followingId },
      update: {},
    });
    return { following: true };
  }

  async unfollow(followerId: string, followingId: string) {
    await this.prisma.follow.deleteMany({ where: { followerId, followingId } });
    return { following: false };
  }

  /** Feed of posts from travellers the user follows. */
  async feed(userId: string, skip = 0, take = 20) {
    const following = await this.prisma.follow.findMany({
      where: { followerId: userId },
      select: { followingId: true },
    });
    const ids = following.map((f) => f.followingId);
    if (!ids.length) return [];

    return this.prisma.post.findMany({
      where: {
        authorId: { in: ids },
        status: ContentStatus.PUBLISHED,
        moderation: ModerationStatus.APPROVED,
        OR: [{ visibleFrom: null }, { visibleFrom: { lte: new Date() } }],
      },
      select: {
        id: true, title: true, coverImageUrl: true, locationName: true, publishedAt: true,
        author: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { publishedAt: 'desc' },
      skip, take,
    });
  }

  /**
   * Admin search. Without this an administrator has no way to find the user
   * they need to act on — every other admin action takes an id they would
   * otherwise have to already know.
   */
  async adminList(q: AdminUserQueryDto) {
    const where: Prisma.UserWhereInput = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.suspendedOnly ? { isSuspended: true } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { phone: { contains: q.q } },
              { email: { contains: q.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, name: true, phone: true, email: true, role: true,
          homeDistrict: true, isSuspended: true, suspendedUntil: true,
          isPhoneVerified: true, totpConfirmedAt: true, createdAt: true,
          _count: { select: { posts: true, reviews: true, ownedBusinesses: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: q.skip, take: q.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return paged(
      items.map((u) => ({
        ...u,
        // Surface the accounts that hold power but have not secured themselves.
        mfaRequired: isPrivileged(u.role),
        mfaEnabled: !!u.totpConfirmedAt,
        totpConfirmedAt: undefined,
      })),
      total, q,
    );
  }

  /**
   * Role changes are the highest-privilege action in the system and were
   * previously the only one leaving no trace. They are now audited, and
   * every existing session is revoked so a new privilege level cannot be
   * used from a token minted under the old one.
   */
  async setRole(userId: string, dto: SetRoleDto, actorId: string) {
    const before = await this.prisma.user.findUnique({
      where: { id: userId }, select: { role: true, name: true },
    });
    if (!before) throw new NotFoundException('Account not found');
    if (userId === actorId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: { id: true, name: true, role: true, totpConfirmedAt: true },
    });

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
    });

    await this.prisma.moderationEntry.create({
      data: {
        moderatorId: actorId,
        targetType: 'USER',
        targetId: userId,
        action: 'CHANGE_ROLE',
        note: `Role changed from ${before.role} to ${dto.role}`,
      },
    });

    return {
      ...user,
      mustEnrolMfa: isPrivileged(dto.role) && !user.totpConfirmedAt,
      totpConfirmedAt: undefined,
    };
  }

  /** Device-lost recovery. Audited, because it removes a security control. */
  async resetMfa(userId: string, actorId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpConfirmedAt: null },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    await this.prisma.moderationEntry.create({
      data: {
        moderatorId: actorId, targetType: 'USER', targetId: userId,
        action: 'RESET_MFA',
        note: 'Two-factor reset by an administrator; user must enrol again on next sign-in.',
      },
    });
    return { reset: true };
  }

  async suspend(userId: string, days: number | null, moderatorId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        isSuspended: true,
        suspendedUntil: days ? new Date(Date.now() + days * 86_400_000) : null,
      },
      select: { id: true, name: true, isSuspended: true, suspendedUntil: true },
    });
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.prisma.moderationEntry.create({
      data: {
        moderatorId, targetType: 'USER', targetId: userId,
        action: 'SUSPEND_USER',
        note: days ? `Suspended for ${days} days` : 'Suspended indefinitely',
      },
    });
    return user;
  }

  async unsuspend(userId: string, moderatorId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isSuspended: false, suspendedUntil: null },
      select: { id: true, name: true, isSuspended: true },
    });
    await this.prisma.moderationEntry.create({
      data: { moderatorId, targetType: 'USER', targetId: userId, action: 'UNSUSPEND_USER' },
    });
    return user;
  }

  /** Deletes the account and everything cascading from it (privacy request). */
  async deleteAccount(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
    return { deleted: true };
  }
}
