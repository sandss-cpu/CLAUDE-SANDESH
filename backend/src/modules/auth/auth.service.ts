import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus,
  Injectable, Logger, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EmailTokenType, Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsService } from './sms.service';
import { MailService } from './mail.service';
import { isPrivileged, MfaService } from './mfa.service';
import type { LinkApp } from './dto/auth.dto';
import { otpMayBeReturnedInResponse, phoneLoginEnabled } from '../../config/env.validation';
import {
  EmailLoginDto, EmailRegisterDto, normaliseEmail, normalisePhone, PasswordResetDto,
  RequestOtpDto, VerifyOtpDto,
} from './dto/auth.dto';

const VERIFY_TTL_MS = 24 * 3_600_000;
const RESET_TTL_MS = 60 * 60_000;

/**
 * Verified against when the account does not exist, so a wrong email and a
 * wrong password take the same time and cannot be told apart. Generated at
 * runtime so it is a real hash with the same cost parameters.
 */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= argon2.hash(crypto.randomBytes(16).toString('hex')));

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
    private mail: MailService,
  ) {}

  private assertPhoneLogin() {
    if (!phoneLoginEnabled(this.config.get('PHONE_LOGIN_ENABLED'), this.config.get('NODE_ENV'))) {
      throw new NotFoundException('Phone sign-in is not available. Use your email instead.');
    }
  }

  // ---------------- step 1: OTP ----------------

  async requestOtp(dto: RequestOtpDto) {
    this.assertPhoneLogin();
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
    this.assertPhoneLogin();
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

    return { isNewUser: isNew, ...(await this.completeSignIn(user)) };
  }

  /**
   * The last step of every sign-in method, so phone and email cannot drift
   * apart on who needs a second factor.
   */
  private async completeSignIn(user: User) {
    const stillSuspended =
      user.isSuspended && (!user.suspendedUntil || user.suspendedUntil > new Date());
    if (stillSuspended) throw new ForbiddenException('This account is suspended.');

    // Ordinary travellers are done here.
    if (!isPrivileged(user.role)) {
      const tokens = await this.issueTokens(user.id, user.role);
      return { mfaRequired: false, user: this.publicUser(user), ...tokens };
    }

    // Privileged roles must present a second factor, or enrol one first.
    if (!user.totpConfirmedAt) {
      return {
        mfaRequired: true,
        mfaEnrolmentRequired: true,
        challengeToken: await this.scopedToken(user.id, SCOPE_MFA_ENROL, '15m'),
        message:
          'This account has elevated permissions and needs an authenticator app before it can be used.',
      };
    }

    return {
      mfaRequired: true,
      mfaEnrolmentRequired: false,
      challengeToken: await this.scopedToken(user.id, SCOPE_MFA_PENDING, '5m'),
      message: 'Enter the 6-digit code from your authenticator app.',
    };
  }

  // ---------------- email + password ----------------

  /**
   * Always answers the same way whether or not the address is registered, so
   * the form cannot be used to discover who has an account.
   */
  async registerEmail(dto: EmailRegisterDto) {
    const email = normaliseEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    const generic = { sent: true, message: 'Check your inbox for a link to confirm your email.' };

    if (existing?.emailVerifiedAt) return generic;

    const passwordHash = await argon2.hash(dto.password);
    // An unverified account has no access yet, so letting a re-registration
    // replace its password is safe: the link still goes to the real inbox.
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id }, data: { passwordHash, name: dto.name.trim() },
        })
      : await this.prisma.user.create({
          data: { email, name: dto.name.trim(), passwordHash, language: 'EN' },
        });

    const devLink = await this.sendLink(user, EmailTokenType.VERIFY, dto.app);
    return { ...generic, devLink };
  }

  async resendVerification(emailRaw: string, app?: LinkApp) {
    const email = normaliseEmail(emailRaw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const generic = { sent: true, message: 'If that account needs confirming, a new link is on its way.' };
    if (!user || user.emailVerifiedAt || !user.passwordHash) return generic;
    const devLink = await this.sendLink(user, EmailTokenType.VERIFY, app);
    return { ...generic, devLink };
  }

  async verifyEmail(rawToken: string) {
    const record = await this.consumeLinkToken(rawToken, EmailTokenType.VERIFY);
    const user = await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { verified: true, ...(await this.completeSignIn(user)) };
  }

  async loginEmail(dto: EmailLoginDto) {
    const email = normaliseEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    const ok = await argon2
      .verify(user?.passwordHash ?? (await getDummyHash()), dto.password)
      .catch(() => false);
    if (!user || !user.passwordHash || !ok) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Confirm your email first. We can send the link again.',
      });
    }
    return this.completeSignIn(user);
  }

  async forgotPassword(emailRaw: string, app?: LinkApp) {
    const email = normaliseEmail(emailRaw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const generic = { sent: true, message: 'If an account uses that email, a reset link is on its way.' };
    if (!user) return generic;
    const devLink = await this.sendLink(user, EmailTokenType.RESET, app);
    return { ...generic, devLink };
  }

  async resetPassword(dto: PasswordResetDto) {
    const record = await this.consumeLinkToken(dto.token, EmailTokenType.RESET);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Receiving the reset link proves the inbox, so it also verifies it.
        data: {
          passwordHash: await argon2.hash(dto.password),
          emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
        },
      }),
      // Anyone holding a session from before the reset is signed out.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() },
      }),
      this.prisma.emailToken.updateMany({
        where: { userId: record.userId, type: EmailTokenType.RESET, consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);
    return { reset: true, message: 'Password updated. Sign in with your new password.' };
  }

  /** Issues a link token and emails it. Returns the link only when it may be echoed (dev). */
  private async sendLink(user: User, type: EmailTokenType, app?: LinkApp): Promise<string | undefined> {
    const recent = await this.prisma.emailToken.count({
      where: { userId: user.id, type, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
    });
    if (recent >= 3) {
      throw new HttpException('Too many emails requested. Please wait 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const raw = crypto.randomBytes(32).toString('base64url');
    await this.prisma.emailToken.create({
      data: {
        userId: user.id, type, tokenHash: this.hash(raw),
        expiresAt: new Date(Date.now() + (type === EmailTokenType.VERIFY ? VERIFY_TTL_MS : RESET_TTL_MS)),
      },
    });

    const web = (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    // The page is chosen from a fixed list, never from the request, so a link can't be pointed elsewhere.
    const page = app === 'owner' ? 'owner.html' : 'login.html';
    const url = `${web}/${page}?${type === EmailTokenType.VERIFY ? 'verify' : 'reset'}=${raw}`;
    const content = type === EmailTokenType.VERIFY
      ? this.mail.linkEmail({
          heading: 'Confirm your email',
          intro: app === 'owner'
            ? `Namaste ${user.name}, confirm this address to start managing your buses on Bato.`
            : `Namaste ${user.name}, confirm this address to start sharing your travels on Bato.`,
          cta: 'Confirm email', url,
          footer: 'This link expires in 24 hours. If you did not sign up, ignore this email.',
        })
      : this.mail.linkEmail({
          heading: 'Reset your password',
          intro: 'Someone asked to reset the password for your Bato account.',
          cta: 'Choose a new password', url,
          footer: 'This link expires in 1 hour. If it was not you, you can safely ignore it.',
        });

    const subject = type === EmailTokenType.VERIFY ? 'Confirm your Bato email' : 'Reset your Bato password';
    const sent = await this.mail.send(user.email!, subject, content.text, content.html);
    const mayEcho = otpMayBeReturnedInResponse(this.config.get('NODE_ENV'), this.mail.isConfigured);
    if (!sent && !mayEcho) {
      throw new HttpException('Could not send the email. Please try again shortly.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    return mayEcho ? url : undefined;
  }

  private async consumeLinkToken(raw: string, type: EmailTokenType) {
    const record = await this.prisma.emailToken.findUnique({
      where: { tokenHash: this.hash(raw) },
      include: { user: true },
    });
    if (!record || record.type !== type || record.consumedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException(
        type === EmailTokenType.VERIFY
          ? 'This confirmation link is invalid or has expired. Request a new one.'
          : 'This reset link is invalid or has expired. Request a new one.',
      );
    }
    await this.prisma.emailToken.update({ where: { id: record.id }, data: { consumedAt: new Date() } });
    return record;
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

  private publicUser(u: {
    id: string; name: string; phone: string | null; email: string | null; role: Role; language: string;
  }) {
    return { id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role, language: u.language };
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
