import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus,
  Injectable, Logger, NotFoundException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { EmailTokenType, Role, User } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { deviceLabel } from './device-label';
import { LoginGuardService } from './login-guard.service';
import { passwordProblem } from './password-policy';
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

/** Where a sign-in came from: the address (hashed before it is stored) and the browser. */
export interface SignInContext { ip?: string | null; userAgent?: string | null }

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
    private guard: LoginGuardService,
    private audit: AuditService,
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

  async verifyOtp(dto: VerifyOtpDto, ctx: SignInContext = {}) {
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

    return { isNewUser: isNew, ...(await this.completeSignIn(user, ctx)) };
  }

  /**
   * The last step of every sign-in method, so phone and email cannot drift
   * apart on who needs a second factor.
   */
  private async completeSignIn(user: User, ctx: SignInContext = {}) {
    const stillSuspended =
      user.isSuspended && (!user.suspendedUntil || user.suspendedUntil > new Date());
    if (stillSuspended) throw new ForbiddenException('This account is suspended.');

    // Ordinary travellers, and bus companies without income records, are done here,
    // unless they chose to set up an authenticator, which is then always asked for.
    const financeOwner = !isPrivileged(user.role) && await this.ownsFinanceCompany(user.id);
    if (!isPrivileged(user.role) && !financeOwner && !user.totpConfirmedAt) {
      return this.session(user, ctx);
    }

    // Privileged roles, and owners whose company keeps its income in Batoma, must present
    // a second factor, or enrol one first.
    if (!user.totpConfirmedAt) {
      return {
        mfaRequired: true,
        mfaEnrolmentRequired: true,
        challengeToken: await this.scopedToken(user.id, SCOPE_MFA_ENROL, '15m'),
        message: financeOwner
          ? 'Your company keeps its income records in Batoma, so this account needs an authenticator app.'
          : 'This account has elevated permissions and needs an authenticator app before it can be used.',
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
    const weak = passwordProblem(dto.password, { email, name: dto.name });
    if (weak) throw new BadRequestException(weak);
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

  async verifyEmail(rawToken: string, ctx: SignInContext = {}) {
    const record = await this.consumeLinkToken(rawToken, EmailTokenType.VERIFY);
    const user = await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    return { verified: true, ...(await this.completeSignIn(user, ctx)) };
  }

  async loginEmail(dto: EmailLoginDto, ctx: SignInContext = {}) {
    const email = normaliseEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Locked accounts and addresses are refused before the password is even checked.
    const keys = this.guard.keys({ userId: user?.id, identifier: email }, ctx.ip);
    await this.guard.assertOpen(keys);

    const ok = await argon2
      .verify(user?.passwordHash ?? (await getDummyHash()), dto.password)
      .catch(() => false);
    if (!user || !user.passwordHash || !ok) {
      await this.guard.failed(keys, { userId: user?.id, what: 'Password sign-in', ip: ctx.ip });
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    await this.guard.succeeded(keys);
    if (!user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Confirm your email first. We can send the link again.',
      });
    }
    return this.completeSignIn(user, ctx);
  }

  async forgotPassword(emailRaw: string, app?: LinkApp) {
    const email = normaliseEmail(emailRaw);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const generic = { sent: true, message: 'If an account uses that email, a reset link is on its way.' };
    if (!user) return generic;
    const devLink = await this.sendLink(user, EmailTokenType.RESET, app);
    return { ...generic, devLink };
  }

  async resetPassword(dto: PasswordResetDto, ctx: SignInContext = {}) {
    const pending = await this.prisma.emailToken.findUnique({ where: { tokenHash: this.hash(dto.token) }, include: { user: { select: { email: true, name: true } } } });
    const weak = passwordProblem(dto.password, { email: pending?.user.email, name: pending?.user.name });
    if (weak) throw new BadRequestException(weak);
    const record = await this.consumeLinkToken(dto.token, EmailTokenType.RESET);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Receiving the reset link proves the inbox, so it also verifies it.
        // Every session from before the reset ends, access tokens included.
        data: {
          passwordHash: await argon2.hash(dto.password),
          emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
          sessionsValidFrom: this.sessionCutoff(),
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
    await this.guard.succeeded(this.guard.keys({ userId: record.userId }));
    await this.audit.record({ actorId: record.userId, action: 'auth.password_reset', entityType: 'User', entityId: record.userId, ip: ctx.ip, summary: 'Password reset by email link; every session signed out' });
    return { reset: true, message: 'Password updated. Sign in with your new password.' };
  }

  /**
   * For an account made by sending a story from the website: a link to choose a first
   * password (the reset link, worded for a new account). Nothing is sent if it has one.
   */
  async sendPasswordSetup(userId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.email || user.passwordHash) return undefined;
    return this.sendLink(user, EmailTokenType.RESET, undefined, 'setup');
  }

  /** Issues a link token and emails it. Returns the link only when it may be echoed (dev). */
  private async sendLink(user: User, type: EmailTokenType, app?: LinkApp, purpose?: 'setup'): Promise<string | undefined> {
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
    const content = purpose === 'setup'
      ? this.mail.linkEmail({
          heading: 'Set a password for Batoma',
          intro: `Namaste ${user.name}, your story is with our editors. Choose a password to sign in to Batoma, where you can write and share your travels.`,
          cta: 'Choose a password', url,
          footer: 'This link expires in 1 hour. You can ask for another from the sign-in page, under "Forgot password".',
        })
      : type === EmailTokenType.VERIFY
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

    const subject = purpose === 'setup' ? 'Set your Batoma password'
      : type === EmailTokenType.VERIFY ? 'Confirm your Bato email' : 'Reset your Bato password';
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
  async verifyMfa(challengeToken: string, code: string, ctx: SignInContext = {}) {
    const payload = await this.readScopedToken(challengeToken, SCOPE_MFA_PENDING);
    const keys = this.guard.keys({ userId: payload.sub }, ctx.ip);
    await this.guard.assertOpen(keys);

    if (!(await this.mfa.verify(payload.sub, code))) {
      await this.guard.failed(keys, { userId: payload.sub, what: 'Authenticator code', ip: ctx.ip });
      throw new UnauthorizedException('That code is not valid');
    }
    await this.guard.succeeded(keys);

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Account not found');
    return this.session(user, ctx);
  }

  /** The authenticator is lost: one recovery code instead of the 6-digit code, once. */
  async recoverMfa(challengeToken: string, code: string, ctx: SignInContext = {}) {
    const payload = await this.readScopedToken(challengeToken, SCOPE_MFA_PENDING);
    const keys = this.guard.keys({ userId: payload.sub }, ctx.ip);
    await this.guard.assertOpen(keys);
    if (!(await this.mfa.useRecoveryCode(payload.sub, code))) {
      await this.guard.failed(keys, { userId: payload.sub, what: 'Recovery code', ip: ctx.ip });
      throw new UnauthorizedException('That recovery code is not valid or was already used');
    }
    await this.guard.succeeded(keys);
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Account not found');
    const left = await this.mfa.recoveryCodesLeft(user.id);
    await this.audit.record({ actorId: user.id, action: 'auth.recovery_code', entityType: 'User', entityId: user.id, ip: ctx.ip, summary: `Signed in with a recovery code; ${left} left` });
    return { ...(await this.session(user, ctx)), recoveryCodesLeft: left };
  }

  /** Completes first-time enrolment and logs the admin straight in. */
  async completeEnrolment(enrolToken: string, code: string, ctx: SignInContext = {}) {
    const payload = await this.readScopedToken(enrolToken, SCOPE_MFA_ENROL);
    const { recoveryCodes } = await this.mfa.confirmEnrolment(payload.sub, code);
    await this.audit.record({ actorId: payload.sub, action: 'auth.mfa_enabled', entityType: 'User', entityId: payload.sub, ip: ctx.ip, summary: 'Authenticator app set up' });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
    return { enabled: true, recoveryCodes, ...(await this.session(user, ctx)) };
  }

  /** Setting up an authenticator while signed in (a bus owner, a partner, a traveller). */
  async confirmSetup(userId: string, code: string, ctx: SignInContext = {}) {
    const result = await this.mfa.confirmEnrolment(userId, code);
    await this.audit.record({ actorId: userId, action: 'auth.mfa_enabled', entityType: 'User', entityId: userId, ip: ctx.ip, summary: 'Authenticator app set up' });
    return result;
  }

  /** A fresh set of recovery codes, for someone who has used or lost theirs. Needs a current code. */
  async regenerateRecoveryCodes(userId: string, code: string, ctx: SignInContext = {}) {
    if (!(await this.mfa.verify(userId, code))) throw new BadRequestException('That code is not valid');
    const recoveryCodes = await this.mfa.issueRecoveryCodes(userId);
    await this.audit.record({ actorId: userId, action: 'auth.recovery_codes', entityType: 'User', entityId: userId, ip: ctx.ip, summary: 'New recovery codes made; the old ones no longer work' });
    return { recoveryCodes };
  }

  async beginEnrolment(enrolToken: string) {
    const payload = await this.readScopedToken(enrolToken, SCOPE_MFA_ENROL);
    return this.mfa.beginEnrolment(payload.sub);
  }

  /** An owner of a company with income records on: their sign-in needs an authenticator. */
  private async ownsFinanceCompany(userId: string) {
    const link = await this.prisma.operatorAdmin.findFirst({
      where: { userId, role: 'OWNER', operator: { financeEnabled: true } },
      select: { operatorId: true },
    });
    return !!link;
  }

  // ---------------- tokens ----------------

  private publicUser(u: {
    id: string; name: string; phone: string | null; email: string | null; role: Role; language: string;
  }) {
    return { id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role, language: u.language };
  }

  private scopedToken(sub: string, scope: string, expiresIn: JwtSignOptions['expiresIn']) {
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

  /** A new session: tokens, and a note of the browser it came from. */
  private async session(user: User, ctx: SignInContext) {
    const tokens = await this.issueTokens(user.id, user.role);
    await this.noteDevice(user, ctx).catch((e) => this.logger.warn(`Device check failed: ${(e as Error).message}`));
    return { mfaRequired: false, user: this.publicUser(user), ...tokens };
  }

  /**
   * The first sign-in from a browser family this account has not used before is
   * reported by email, so a stolen password shows itself. The very first sign-in
   * is just remembered.
   */
  private async noteDevice(user: User, ctx: SignInContext) {
    const label = deviceLabel(ctx.userAgent);
    const deviceHash = crypto.createHash('sha256').update(`${user.id}:${label}`).digest('hex');
    const known = await this.prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId: user.id, deviceHash } } });
    if (known) {
      await this.prisma.knownDevice.update({ where: { id: known.id }, data: { lastSeenAt: new Date() } });
      return;
    }
    const others = await this.prisma.knownDevice.count({ where: { userId: user.id } });
    await this.prisma.knownDevice.create({ data: { userId: user.id, deviceHash, label } });
    if (!others) return;
    await this.audit.record({ actorId: user.id, action: 'auth.new_device', entityType: 'User', entityId: user.id, ip: ctx.ip, summary: `First sign-in from ${label}` });
    if (!user.email) return;
    const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    const web = (this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    const { text, html } = this.mail.linkEmail({
      heading: 'New sign-in to your Batoma account',
      intro: `Someone signed in to your account from ${label} on ${when} (Nepal time). If it was you, there is nothing to do.`,
      cta: 'It was not me: reset my password', url: `${web}/login.html?forgot=1`,
      footer: 'After resetting your password, every other session is signed out. You can also choose "Sign out everywhere" once you are signed in.',
    });
    await this.mail.send(user.email, 'New sign-in to your Batoma account', text, html);
  }

  /** Whole seconds, because a token's issue time is in whole seconds. */
  private sessionCutoff() {
    return new Date(Math.floor(Date.now() / 1000) * 1000);
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

  /** Every session on every device: refresh tokens revoked, access tokens refused from now. */
  async logoutAll(userId: string, ctx: SignInContext = {}) {
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.user.update({ where: { id: userId }, data: { sessionsValidFrom: this.sessionCutoff() } }),
    ]);
    await this.audit.record({ actorId: userId, action: 'auth.logout_all', entityType: 'User', entityId: userId, ip: ctx.ip, summary: 'Signed out everywhere' });
    return { loggedOut: true };
  }
}
