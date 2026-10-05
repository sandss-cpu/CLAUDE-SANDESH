import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { sendFile } from '../../common/utils/send-file';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { AdminUserQueryDto, DeleteAccountDto, SetRoleDto, UpdatePrivacyDto, UpdateProfileDto } from './dto/user.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  me(@CurrentUser('id') userId: string) { return this.users.me(userId); }

  @Patch('me')
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(userId, dto);
  }

  @Patch('me/privacy')
  privacy(@CurrentUser('id') userId: string, @Body() dto: UpdatePrivacyDto) {
    return this.users.updatePrivacy(userId, dto);
  }

  /** Everything held about the signed-in person, as a JSON file. */
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Get('me/export')
  async export(@CurrentUser('id') userId: string, @Ip() ip: string, @Res() res: Response) {
    sendFile(res, await this.users.exportAccount(userId, ip));
  }

  /** Deleting one's own account needs the password (and authenticator code) again. */
  @Throttle({ default: { limit: 5, ttl: 900_000 } })
  @Delete('me')
  remove(@CurrentUser('id') userId: string, @Body() dto: DeleteAccountDto, @Ip() ip: string) {
    return this.users.deleteAccount(userId, dto, ip);
  }

  @Get('me/feed')
  feed(
    @CurrentUser('id') userId: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.users.feed(userId, Number(skip ?? 0), Number(take ?? 20));
  }

  /** Admin directory. Declared before :id so the literal path wins. */
  @Roles(Role.ADMIN, Role.MODERATOR) @Get('admin/directory')
  directory(@Query() q: AdminUserQueryDto) { return this.users.adminList(q); }

  @Public() @Get(':id')
  profile(@Param('id') id: string) { return this.users.publicProfile(id); }

  @Post(':id/follow')
  follow(@Param('id') id: string, @CurrentUser('id') me: string) {
    return this.users.follow(me, id);
  }

  @Delete(':id/follow')
  unfollow(@Param('id') id: string, @CurrentUser('id') me: string) {
    return this.users.unfollow(me, id);
  }

  @Roles(Role.ADMIN) @Patch(':id/role')
  setRole(@Param('id') id: string, @Body() dto: SetRoleDto, @CurrentUser('id') actorId: string) {
    return this.users.setRole(id, dto, actorId);
  }

  /** Recovery when an admin loses their authenticator device. */
  @Roles(Role.ADMIN) @Patch(':id/reset-mfa')
  resetMfa(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.users.resetMfa(id, actorId);
  }

  @Roles(Role.ADMIN, Role.MODERATOR) @Patch(':id/suspend')
  suspend(
    @Param('id') id: string,
    @Body('days') days: number | null,
    @CurrentUser('id') moderatorId: string,
  ) {
    return this.users.suspend(id, days ?? null, moderatorId);
  }

  @Roles(Role.ADMIN, Role.MODERATOR) @Patch(':id/unsuspend')
  unsuspend(@Param('id') id: string, @CurrentUser('id') moderatorId: string) {
    return this.users.unsuspend(id, moderatorId);
  }
}
