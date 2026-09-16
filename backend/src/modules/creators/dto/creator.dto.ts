import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUrl, IsUUID,
  Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { ContentStatus, CreatorStatus } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const blankToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));

/** Handles appear in profile links, so keep them to the characters a URL can carry plainly. */
export const HANDLE_RULE = /^[a-z0-9_]{3,24}$/;
export const RESERVED_HANDLES = [
  'admin', 'bato', 'support', 'help', 'api', 'me', 'new', 'edit', 'settings', 'login', 'signup', 'creator', 'creators',
];

export class ApplyCreatorDto {
  @trim() @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @Matches(HANDLE_RULE, { message: 'Handles are 3–24 characters: lower-case letters, numbers and underscores' })
  handle: string;

  @trim() @IsString() @Length(2, 60, { message: 'Enter the name you want on your profile' })
  displayName: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120)
  headline?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000)
  bio?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(80)
  homeBase?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(30, { each: true })
  specialities?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) @MaxLength(30, { each: true })
  languages?: string[];

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(500)
  avatarUrl?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(500)
  coverUrl?: string;

  @blankToUndefined() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Website must start with https://' }) @MaxLength(300)
  websiteUrl?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60)
  instagram?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60)
  youtube?: string;
}

/** The handle is set once at application; everything else stays editable. */
export class UpdateCreatorDto extends ApplyCreatorDto {
  @IsOptional()
  handle: string;
}

export class SaveJourneyDto {
  @trim() @IsString() @Length(3, 140, { message: 'Give the journey a title' })
  title: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(600)
  summary?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(500)
  coverImageUrl?: string;

  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Unknown route' })
  routeId?: string;

  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Unknown destination' })
  destinationId?: string;

  @blankToUndefined() @IsOptional() @IsISO8601({}, { message: 'Start date is not a valid date' })
  startedOn?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(400)
  dayCount?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  transportNpr?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  stayNpr?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  foodNpr?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  permitsNpr?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  otherNpr?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(60, { each: true })
  gear?: string[];

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(2000)
  tips?: string;
}

export class JourneyStatusDto {
  @IsEnum(ContentStatus)
  status: ContentStatus;
}

export class AddJourneyPostDto {
  @IsUUID('4', { message: 'Choose one of your posts' })
  postId: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(400)
  dayNumber?: number;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class ReorderJourneyPostsDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('4', { each: true })
  postIds: string[];
}

export class CreatorReviewDto {
  @IsEnum(CreatorStatus)
  status: CreatorStatus;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(500)
  note?: string;

  @IsOptional() @IsBoolean()
  isFeatured?: boolean;
}

export class CreatorListQueryDto {
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60)
  q?: string;

  @blankToUndefined() @IsOptional() @IsEnum(CreatorStatus)
  status?: CreatorStatus;
}
