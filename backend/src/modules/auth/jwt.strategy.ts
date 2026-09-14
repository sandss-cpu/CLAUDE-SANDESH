import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { isPrivileged } from './mfa.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; scope?: string }): Promise<AuthUser> {
    /**
     * Challenge and enrolment tokens are signed with the same key but carry a
     * scope. They must never be accepted as a session token, or the second
     * factor could be skipped entirely by calling the API with the challenge.
     */
    if (payload.scope) {
      throw new UnauthorizedException('This token cannot be used to access the API');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, role: true, phone: true,
        isSuspended: true, suspendedUntil: true, totpConfirmedAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Account not found');

    const stillSuspended =
      user.isSuspended && (!user.suspendedUntil || user.suspendedUntil > new Date());
    if (stillSuspended) throw new UnauthorizedException('Account suspended');

    /**
     * Defence in depth: if a role was elevated after this token was issued,
     * the token itself would still be valid. Re-check the second factor
     * against the current role rather than trusting the claim in the token.
     */
    if (isPrivileged(user.role) && !user.totpConfirmedAt) {
      throw new UnauthorizedException(
        'This account now requires two-factor authentication. Please sign in again.',
      );
    }

    return { id: user.id, role: user.role, phone: user.phone ?? undefined };
  }
}
