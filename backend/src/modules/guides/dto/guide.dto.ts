import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsLatitude, IsLongitude, IsOptional,
  IsString, IsUUID, Length, Max, MaxLength, Min,
} from 'class-validator';
import { ContentStatus, GuideDirection, GuideStopKind } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const blankToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class SaveGuideDto {
  @IsUUID('4', { message: 'Choose the route this guide covers' })
  routeId: string;

  @IsEnum(GuideDirection, { message: 'Choose which way the traveller is going' })
  direction: GuideDirection;

  @trim() @IsString() @Length(3, 140, { message: 'Title must be 3–140 characters' })
  title: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(600)
  summary?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(500)
  coverImageUrl?: string;

  @IsOptional() @IsEnum(ContentStatus)
  status?: ContentStatus;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999)
  sortOrder?: number;
}

export class SaveGuideStopDto {
  @IsEnum(GuideStopKind, { message: 'Choose what kind of stop this is' })
  kind: GuideStopKind;

  @trim() @IsString() @Length(2, 140, { message: 'Name must be 2–140 characters' })
  name: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(500)
  imageUrl?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsLatitude()
  latitude?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsLongitude()
  longitude?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(2000)
  distanceFromStartKm?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000)
  minutesFromStart?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000)
  priceFromNpr?: number;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120)
  openingHours?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(40)
  contactPhone?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(300)
  tip?: string;

  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Unknown place' })
  placeId?: string;

  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Unknown business' })
  businessId?: string;

  @IsOptional() @IsBoolean()
  isHighlight?: boolean;
}

export class ReorderStopsDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true })
  ids: string[];
}

export class GuideStatusDto {
  @IsEnum(ContentStatus)
  status: ContentStatus;
}

export class JourneyQueryDto {
  @blankToUndefined() @IsOptional() @IsUUID('4')
  routeId?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60)
  from?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60)
  to?: string;
}

export class GuideDirectionQueryDto {
  @IsOptional() @IsEnum(GuideDirection)
  direction?: GuideDirection;
}

export class AdminGuideQueryDto {
  @blankToUndefined() @IsOptional() @IsEnum(ContentStatus)
  status?: ContentStatus;

  @blankToUndefined() @IsOptional() @IsUUID('4')
  routeId?: string;
}
