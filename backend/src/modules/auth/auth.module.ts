import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SmsService } from './sms.service';
import { MfaService } from './mfa.service';
import { MailService } from './mail.service';
import { LoginGuardService } from './login-guard.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // A duration such as "15m"; jsonwebtoken rejects anything it cannot parse.
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '15m') as JwtSignOptions['expiresIn'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SmsService, MfaService, MailService, LoginGuardService],
  exports: [AuthService, MfaService, MailService],
})
export class AuthModule {}
