import { Injectable } from '@nestjs/common';
import { ModerationAct, TargetType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { THEME_BACKGROUNDS, THEME_PALETTES, UpdateThemeDto } from './dto/settings.dto';

const ROW_ID = 'app';

/**
 * How Batoma looks, for everyone. One row, read by every page on load and written
 * only from the control panel, so an admin can change the platform's colours and
 * background without a deploy.
 */
@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async theme() {
    const saved = await this.prisma.platformSetting.findUnique({ where: { id: ROW_ID } });
    const row = saved ?? await this.prisma.platformSetting.create({ data: { id: ROW_ID } });
    return {
      themePalette: row.themePalette,
      themeBackground: row.themeBackground,
      appName: row.appName,
      tagline: row.tagline,
      updatedAt: row.updatedAt,
      /** So the control panel can offer exactly what the pages can render. */
      palettes: THEME_PALETTES,
      backgrounds: THEME_BACKGROUNDS,
    };
  }

  async updateTheme(dto: UpdateThemeDto, adminId: string) {
    const data = {
      ...(dto.themePalette ? { themePalette: dto.themePalette } : {}),
      ...(dto.themeBackground ? { themeBackground: dto.themeBackground } : {}),
      ...(dto.appName ? { appName: dto.appName } : {}),
      ...(dto.tagline !== undefined ? { tagline: dto.tagline || null } : {}),
      updatedById: adminId,
    };
    await this.prisma.platformSetting.upsert({
      where: { id: ROW_ID },
      update: data,
      create: { id: ROW_ID, ...data },
    });
    // Everyone sees this change, so it belongs in the same audit trail as the rest.
    await this.prisma.moderationEntry.create({
      data: {
        moderatorId: adminId, targetType: TargetType.AD, targetId: ROW_ID, action: ModerationAct.UPDATE,
        note: `Appearance: ${dto.themePalette ?? 'palette unchanged'} / ${dto.themeBackground ?? 'background unchanged'}`,
      },
    });
    return this.theme();
  }
}
