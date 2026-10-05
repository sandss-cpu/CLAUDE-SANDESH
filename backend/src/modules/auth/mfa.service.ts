import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
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

/** Ten one-time recovery codes, "k7m2p-xq4hz": 50 bits each, no 0/o or 1/l to misread. */
export const RECOVERY_CODE_COUNT = 10;
const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
const hashRecoveryCode = (code: string) => createHash('sha256').update(`batoma-recovery:${normaliseRecoveryCode(code)}`).digest('hex');
export function newRecoveryCode(): string {
  const chars = Array.from({ length: 10 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
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
      select: { phone: true, email: true, totpConfirmedAt: true },
    });
    if (user?.totpConfirmedAt) {
      throw new BadRequestException('Two-factor is already set up on this account');
    }

    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpConfirmedAt: null },
    });

    const otpauthUri = authenticator.keyuri(user?.email ?? user?.phone ?? userId, 'Batoma', secret);
    return {
      secret,
      otpauthUri,
      // Drawn here so no page needs a QR library; it encodes only the URI above.
      qrSvg: await QRCode.toString(otpauthUri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }),
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
    return { enabled: true, recoveryCodes: await this.issueRecoveryCodes(userId) };
  }

  /**
   * Replaces any earlier set. Shown once: only hashes are kept (codes are random enough
   * that a fast hash is safe; there is nothing to guess from).
   */
  async issueRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
      this.prisma.recoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashRecoveryCode(c) })) }),
    ]);
    return codes;
  }

  /** Uses up one code; true if it was valid and unused. */
  async useRecoveryCode(userId: string, code: string): Promise<boolean> {
    if (normaliseRecoveryCode(code).length !== 10) return false;
    const used = await this.prisma.recoveryCode.updateMany({
      where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    return used.count === 1;
  }

  async recoveryCodesLeft(userId: string): Promise<number> {
    return this.prisma.recoveryCode.count({ where: { userId, usedAt: null } });
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
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpConfirmedAt: null } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
    return { reset: true };
  }
}
