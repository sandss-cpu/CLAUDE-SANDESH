import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import {
  EmailLoginDto, EmailOnlyDto, EmailRegisterDto, MfaVerifyDto, PasswordResetDto, RefreshDto,
  RequestOtpDto, TokenDto, VerifyOtpDto, MfaSetupConfirmDto, MfaRecoverDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClientContext } from '../../common/decorators/client-context.decorator';
import type { SignInContext } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private mfa: MfaService) {}

  /** Step 1 — send a 6-digit code by SMS. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto);
  }

  /**
   * Step 2 — exchange the code for tokens.
   * Travellers receive a session. Privileged roles receive a challenge token
   * and must complete step 3.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifyOtpDto, @ClientContext() ctx: SignInContext) {
    return this.auth.verifyOtp(dto, ctx);
  }

  // ---- email + password ----

  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('email/register')
  registerEmail(@Body() dto: EmailRegisterDto) {
    return this.auth.registerEmail(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('email/verify')
  verifyEmail(@Body() dto: TokenDto, @ClientContext() ctx: SignInContext) {
    return this.auth.verifyEmail(dto.token, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('email/resend')
  resendVerification(@Body() dto: EmailOnlyDto) {
    return this.auth.resendVerification(dto.email, dto.app);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('email/login')
  loginEmail(@Body() dto: EmailLoginDto, @ClientContext() ctx: SignInContext) {
    return this.auth.loginEmail(dto, ctx);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('password/forgot')
  forgotPassword(@Body() dto: EmailOnlyDto) {
    return this.auth.forgotPassword(dto.email, dto.app);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('password/reset')
  resetPassword(@Body() dto: PasswordResetDto, @ClientContext() ctx: SignInContext) {
    return this.auth.resetPassword(dto, ctx);
  }

  /** Step 3 — authenticator code for admins, editors, moderators, operators. */
  @Public()
  @Throttle({ default: { limit: 8, ttl: 900_000 } })
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto, @ClientContext() ctx: SignInContext) {
    return this.auth.verifyMfa(dto.challengeToken, dto.code, ctx);
  }

  /** Step 3 without the phone: one of the recovery codes given when the authenticator was set up. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('mfa/recover')
  recoverMfa(@Body() dto: MfaRecoverDto, @ClientContext() ctx: SignInContext) {
    return this.auth.recoverMfa(dto.challengeToken, dto.code, ctx);
  }

  /** First-time setup: returns the otpauth:// URI to scan. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('mfa/enrol/start')
  startEnrolment(@Body('challengeToken') challengeToken: string) {
    return this.auth.beginEnrolment(challengeToken);
  }

  @Public()
  @Throttle({ default: { limit: 8, ttl: 900_000 } })
  @Post('mfa/enrol/confirm')
  confirmEnrolment(@Body() dto: MfaVerifyDto, @ClientContext() ctx: SignInContext) {
    return this.auth.completeEnrolment(dto.challengeToken, dto.code, ctx);
  }

  /**
   * Setting up an authenticator while signed in: a bus company owner turning on income
   * records, for example. The code must then be confirmed before it counts.
   */
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('mfa/setup')
  startSetup(@CurrentUser('id') userId: string) {
    return this.mfa.beginEnrolment(userId);
  }

  @Throttle({ default: { limit: 8, ttl: 900_000 } })
  @Post('mfa/setup/confirm')
  confirmSetup(@CurrentUser('id') userId: string, @Body() dto: MfaSetupConfirmDto, @ClientContext() ctx: SignInContext) {
    return this.auth.confirmSetup(userId, dto.code, ctx);
  }

  /** New recovery codes, replacing the old ones; needs a current authenticator code. */
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Post('mfa/recovery-codes')
  recoveryCodes(@CurrentUser('id') userId: string, @Body() dto: MfaSetupConfirmDto, @ClientContext() ctx: SignInContext) {
    return this.auth.regenerateRecoveryCodes(userId, dto.code, ctx);
  }

  @Public() @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public() @Post('logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Post('logout-all')
  logoutAll(@CurrentUser('id') userId: string, @ClientContext() ctx: SignInContext) {
    return this.auth.logoutAll(userId, ctx);
  }
}
