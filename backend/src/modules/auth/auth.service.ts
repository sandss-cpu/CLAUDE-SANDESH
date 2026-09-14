import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus,
  Injectable, Logger, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from './sms.service';
import { isPrivileged, MfaService } from './mfa.service';
import { otpMayBeReturnedInResponse } from '../../config/env.validation';
import { normalisePhone, RequestOtpDto, VerifyOtpDto } from './dto/auth.dto';

/** Token scopes. A scoped token cannot be used as a normal session. */
export const SCOPE_MFA_PENDING = 'mfa_pending';
export const SCOPE_MFA_ENROL = 'mfa_enrol';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
    private sms: SmsService,
    private mfa: MfaService,
  ) {}

  // ---------------- step 1: OTP ----------------

  async requestOtp(dto: RequestOtpDto) {
    const phone = normalisePhone(dto.phone);
    const ttl = Number(this.config.get('OTP_TTL_MINUTES') ?? 5);

    const recent = await this.prisma.otpCode.count({
      where: { phone, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    });
    if (recent >= 3) {
      throw new HttpException(
        'Too many code requests. Please wait 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(crypto.randomInt(100000, 999999));
    await this.prisma.otpCode.create({
      data: {
        phone,
        codeHash: await argon2.hash(code),
        expiresAt: new Date(Date.now() + ttl * 60_000),
      },
    });

    const sent = await this.sms.send(
      phone, `${code} is your Bato code. It expires in ${ttl} minutes.`,
    );

    /**
     * The code is only ever echoed back outside production. In production
     * a missing gateway is a startup failure (see env.validation.ts), so
     * this branch is unreachable there.
     */
    const mayEcho = otpMayBeReturnedInResponse(
      this.config.get('NODE_ENV'), this.sms.isConfigured,
    );
    if (!sent && !mayEcho) {
      throw new HttpException(
        'Could not send the code. Please try again shortly.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      phone,
      expiresInSeconds: ttl * 60,
      devCode: mayEcho ? code : undefined,
    };
  }

  // ---------------- step 2: verify, then branch on privilege ----------------

  async verifyOtp(dto: VerifyOtpDto) {
    const phone = normalisePhone(dto.phone);
    const maxAttempts = Number(this.config.get('OTP_MAX_ATTEMPTS') ?? 5);

    const otp = await this.prisma.otpCode.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('The code has expired. Request a new one.');
    if (otp.attempts >= maxAttempts) {
      throw new BadRequestException('Too many incorrect attempts. Request a new code.');
    }

    if (!(await argon2.verify(otp.codeHash, dto.code))) {
      await this.prisma.otpCode.update({
        where: { id: otp.id }, data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Incorrect code');
    }

    await this.prisma.otpCode.update({
      where: { id: otp.id }, data: { consumedAt: new Date() },
    });

    let user = await this.prisma.user.findUnique({ where: { phone } });
    const isNew = !user;
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          name: dto.name?.trim() || `Traveller ${phone.slice(-4)}`,
          isPhoneVerified: true,
          language: dto.language ?? 'NE',
        },
      });
    } else if (!user.isPhoneVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id }, data: { isPhoneVerified: true },
      });
    }

    // Ordinary travellers are done here.
    if (!isPrivileged(user.role)) {
      const tokens = await this.issueTokens(user.id, user.role);
      return { isNewUser: isNew, mfaRequired: false, user: this.publicUser(user), ...tokens };
    }

    // Privileged roles must present a second factor, or enrol one first.
    if (!user.totpConfirmedAt) {
      return {
        isNewUser: isNew,
        mfaRequired: true,
        mfaEnrolmentRequired: true,
        challengeToken: await this.scopedToken(user.id, SCOPE_MFA_ENROL, '15m'),
        message:
          'This account has elevated permissions and needs an authenticator app before it can be used.',
      };
    }

    return {
      isNewUser: false,
      mfaRequired: true,
      mfaEnrolmentRequired: false,
      challengeToken: await this.scopedToken(user.id, SCOPE_MFA_PENDING, '5m'),
      message: 'Enter the 6-digit code from your authenticator app.',
    };
  }

  /** Step 3 for privileged roles: challenge token + TOTP becomes a real session. */
  async verifyMfa(challengeToken: string, code: string) {
    const payload = await this.readScopedToken(challengeToken, SCOPE_MFA_PENDING);

    if (!(await this.mfa.verify(payload.sub, code))) {
      this.logger.warn(`Failed MFA attempt for user ${payload.sub}`);
      throw new UnauthorizedException('That code is not valid');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Account not found');

    const tokens = await this.issueTokens(user.id, user.role);
    return { mfaRequired: false, user: this.publicUser(user), ...tokens };
  }

  /** Completes first-time enrolment and logs the admin straight in. */
  async completeEnrolment(enrolToken: string, code: string) {
    const payload = await this.readScopedToken(enrolToken, SCOPE_MFA_ENROL);
    await this.mfa.confirmEnrolment(payload.sub, code);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    const tokens = await this.issueTokens(user.id, user.role);
    return { enabled: true, user: this.publicUser(user), ...tokens };
  }

  async beginEnrolment(enrolToken: string) {
    const payload = await this.readScopedToken(enrolToken, SCOPE_MFA_ENROL);
    return this.mfa.beginEnrolment(payload.sub);
  }

  // ---------------- tokens ----------------

  private publicUser(u: { id: string; name: string; phone: string; role: Role; language: string }) {
    return { id: u.id, name: u.name, phone: u.phone, role: u.role, language: u.language };
  }

  private scopedToken(sub: string, scope: string, expiresIn: string) {
    return this.jwt.signAsync({ sub, scope }, { expiresIn });
  }

  private async readScopedToken(token: string, expectedScope: string) {
    let payload: { sub: string; scope?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch (_) {
      throw new UnauthorizedException('This challenge has expired. Sign in again.');
    }
    if (payload.scope !== expectedScope) {
      throw new ForbiddenException('Wrong token type for this step');
    }
    return payload;
  }

  private async issueTokens(userId: string, role: Role, familyId?: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, role },
      { expiresIn: this.config.get('JWT_EXPIRES_IN') ?? '15m' },
    );

    const raw = crypto.randomBytes(48).toString('base64url');
    const days = Number(this.config.get('REFRESH_EXPIRES_DAYS') ?? 60);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: familyId ?? crypto.randomUUID(),
        tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });

    return {
      accessToken,
      refreshToken: raw,
      expiresIn: this.config.get('JWT_EXPIRES_IN') ?? '15m',
    };
  }

  private hash(raw: string) {
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Rotating refresh with reuse detection.
   *
   * A token is single-use. If an already-revoked one is presented, it was
   * captured — the legitimate holder has moved on to a newer token. Killing
   * the whole family logs the attacker and the victim out together, which is
   * the correct trade: the victim signs in again, the attacker gets nothing.
   */
  async refresh(rawToken: string) {
    const tokenHash = this.hash(rawToken);

    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) throw new UnauthorizedException('Session expired. Please sign in again.');

    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.error(
        `Refresh token reuse detected for user ${record.userId}. Family ${record.familyId} revoked.`,
      );
      throw new UnauthorizedException(
        'This session was reused and has been closed for your security. Please sign in again.',
      );
    }

    if (record.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id }, data: { revokedAt: new Date() },
    });

    return this.issueTokens(record.userId, record.user.role, record.familyId);
  }

  async logout(rawToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hash(rawToken) },
    });
    if (record) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: record.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { loggedOut: true };
  }

  async logoutAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null }, data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }
}
