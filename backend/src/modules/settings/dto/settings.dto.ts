import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * The palettes and backgrounds the platform ships with. Kept here so the API and
 * the control panel cannot drift apart, and so an admin can only ever pick one
 * that the pages actually have styles for.
 */
export const THEME_PALETTES = [
  'prayer-flag', 'rhododendron', 'himalaya-dawn', 'teahouse', 'forest-trail',
  'monsoon', 'lakeside-sunset', 'night-bus',
] as const;

export const THEME_BACKGROUNDS = [
  'none', 'rhododendron', 'prayer-flags', 'himalaya', 'terraced-fields', 'newar-lattice', 'paper-grain',
] as const;

export class UpdateThemeDto {
  @IsOptional() @IsIn(THEME_PALETTES, { message: 'Choose one of Batoma’s palettes' })
  themePalette?: string;

  @IsOptional() @IsIn(THEME_BACKGROUNDS, { message: 'Choose one of Batoma’s backgrounds' })
  themeBackground?: string;

  @trim() @IsOptional() @IsString() @MaxLength(40)
  appName?: string;

  @trim() @IsOptional() @IsString() @MaxLength(120)
  tagline?: string;
}
