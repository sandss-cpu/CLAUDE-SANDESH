import { BadRequestException, Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { Role } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Roles that can change other people's data, money or content at platform
 * scale. An SMS code is not an adequate sole factor for these — SIM-swap
 * against a single number would otherwise hand over the whole platform.
 */
export const PRIVILEGED_ROLES: Role[] = [
  Role.ADMIN, Role.EDITOR, Role.MODERATOR, Role.OPERATOR_ADMIN,
];

export function isPrivileged(role: Role): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

@Injectable()
export class MfaService {
  constructor(private prisma: PrismaService) {
    // Accept the previous and next 30-second window for clock drift.
    authenticator.options = { window: 1 };
  }

  /**
   * Generate a secret and the otpauth:// URI the authenticator app scans.
   * The secret is stored but not yet confirmed, so it cannot be used to log
   * in until the user proves they can generate a code from it.
   */
  async beginEnrolment(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, totpConfirmedAt: true },
    });
    if (user?.totpConfirmedAt) {
      throw new BadRequestException('Two-factor is already set up on this account');
    }

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpConfirmedAt: null },
    });

    return {
      secret,
      otpauthUri: authenticator.keyuri(user?.phone ?? userId, 'Bato Admin', secret),
      instructions:
        'Scan this in Google Authenticator or Authy, then confirm with the 6-digit code.',
    };
  }

  async confirmEnrolment(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true },
    });
    if (!user?.totpSecret) throw new BadRequestException('Start two-factor setup first');
    if (!authenticator.check(code, user.totpSecret)) {
      throw new BadRequestException('That code is not valid');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpConfirmedAt: new Date() },
    });
    return { enabled: true };
  }

  async verify(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpSecret: true, totpConfirmedAt: true },
    });
    if (!user?.totpSecret || !user.totpConfirmedAt) return false;
    return authenticator.check(code, user.totpSecret);
  }

  /** Admin recovery path when a device is lost. Always audited by the caller. */
  async reset(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpConfirmedAt: null },
    });
    return { reset: true };
  }
}
