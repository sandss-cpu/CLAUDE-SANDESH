import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  EmailLoginDto, EmailOnlyDto, EmailRegisterDto, MfaVerifyDto, PasswordResetDto, RefreshDto,
  RequestOtpDto, TokenDto, VerifyOtpDto,
} from './dto/auth.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

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
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
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
  verifyEmail(@Body() dto: TokenDto) {
    return this.auth.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('email/resend')
  resendVerification(@Body() dto: EmailOnlyDto) {
    return this.auth.resendVerification(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('email/login')
  loginEmail(@Body() dto: EmailLoginDto) {
    return this.auth.loginEmail(dto);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 900_000 } })
  @Post('password/forgot')
  forgotPassword(@Body() dto: EmailOnlyDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 900_000 } })
  @Post('password/reset')
  resetPassword(@Body() dto: PasswordResetDto) {
    return this.auth.resetPassword(dto);
  }

  /** Step 3 — authenticator code for admins, editors, moderators, operators. */
  @Public()
  @Throttle({ default: { limit: 8, ttl: 900_000 } })
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaVerifyDto) {
    return this.auth.verifyMfa(dto.challengeToken, dto.code);
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
  confirmEnrolment(@Body() dto: MfaVerifyDto) {
    return this.auth.completeEnrolment(dto.challengeToken, dto.code);
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
  logoutAll(@CurrentUser('id') userId: string) {
    return this.auth.logoutAll(userId);
  }
}
