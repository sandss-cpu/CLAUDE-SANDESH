import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, IsUUID,
  Length, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { AdDurationUnit, AdLinkType, AdPlacement } from '@prisma/client';

export const AD_STATUSES = ['ACTIVE', 'SCHEDULED', 'EXPIRED', 'PAUSED'] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

/** Admins submit the whole form on create and on edit. */
export class SaveAdDto {
  @IsString() @Length(3, 120, { message: 'Headline must be 3–120 characters' })
  title: string;

  @IsString() @Length(2, 80, { message: 'Advertiser name must be 2–80 characters' })
  advertiserName: string;

  @IsOptional() @IsString() @MaxLength(160)
  tagline?: string;

  @IsString() @MaxLength(500)
  imageUrl: string;

  @IsEnum(AdPlacement, { message: 'Choose where the ad appears' })
  placement: AdPlacement;

  @IsEnum(AdDurationUnit, { message: 'Choose day, week or month' })
  durationUnit: AdDurationUnit;

  @Type(() => Number) @IsInt() @Min(1) @Max(52, { message: 'Run length can be at most 52 units' })
  durationCount: number;

  /** Defaults to now. */
  @IsOptional() @IsISO8601({}, { message: 'Start date is not a valid date' })
  startsAt?: string;

  @IsEnum(AdLinkType, { message: 'Choose where a click goes' })
  linkType: AdLinkType;

  @ValidateIf((o) => o.linkType === AdLinkType.EXTERNAL)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Website link must start with https://' })
  @MaxLength(500)
  externalUrl?: string;

  @ValidateIf((o) => o.linkType === AdLinkType.OVERVIEW)
  @IsString({ message: 'Overview page needs a heading (3–120 characters)' })
  @Length(3, 120, { message: 'Overview page needs a heading (3–120 characters)' })
  overviewTitle?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  overviewBody?: string;

  @IsOptional() @IsString() @MaxLength(500)
  overviewImageUrl?: string;

  @IsOptional() @IsUUID('4', { message: 'Unknown business' })
  businessId?: string;

  /** Empty means every route. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('4', { each: true, message: 'Unknown route' })
  routeIds?: string[];

  /** WEB_SECTION_SPONSOR: the magazine section it sponsors. */
  @ValidateIf((o) => o.placement === AdPlacement.WEB_SECTION_SPONSOR)
  @IsUUID('4', { message: 'Choose the magazine section this sponsors' })
  targetCategoryId?: string;

  /** WEB_DESTINATION_SPONSOR: the place whose page it sponsors. */
  @ValidateIf((o) => o.placement === AdPlacement.WEB_DESTINATION_SPONSOR)
  @IsUUID('4', { message: 'Choose the place this sponsors' })
  targetDestinationId?: string;
}

export class AdSlotQueryDto {
  @IsEnum(AdPlacement)
  placement: AdPlacement;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5)
  limit?: number;

  /** The corridor the traveller is on, so route-targeted ads can win the slot. */
  @IsOptional() @IsUUID('4')
  routeId?: string;
}

export const AD_SURFACES = ['app', 'web'] as const;
export type AdSurface = (typeof AD_SURFACES)[number];

export class AdminAdQueryDto {
  @IsOptional() @IsIn(AD_STATUSES)
  status?: AdStatus;

  /** The public website's slots (WEB_*) or the app's; both when absent. */
  @IsOptional() @IsIn(AD_SURFACES)
  surface?: AdSurface;
}

export class ImpressionsDto {
  @IsArray() @ArrayMaxSize(20) @IsUUID('4', { each: true })
  ids: string[];
}

export class SetAdActiveDto {
  @IsBoolean()
  isActive: boolean;
}
