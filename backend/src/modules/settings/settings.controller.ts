import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { SettingsService } from './settings.service';
import { UpdateThemeDto } from './dto/settings.dto';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService) {}

  /** Read by every page before it paints, so it must stay public and cheap. */
  @Public() @Get('theme')
  theme() { return this.settings.theme(); }

  @Roles(Role.ADMIN) @Patch('theme')
  updateTheme(@Body() dto: UpdateThemeDto, @CurrentUser('id') adminId: string) {
    return this.settings.updateTheme(dto, adminId);
  }
}
