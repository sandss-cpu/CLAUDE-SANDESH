import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsISO8601,
  IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { GuideDirection, NoticeSeverity } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const blankToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));
/** On an edit, an empty field means "clear it", which is different from leaving it out. */
const blankToNull = () => Transform(({ value }) => (value === '' ? null : value));
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Which list is being edited. The most specific target given decides the scope:
 * a bus, else a company, else a route, else the DEFAULT list every bus falls back to.
 */
export class SlotQueryDto {
  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Choose a route' })
  routeId?: string;

  @blankToUndefined() @IsOptional() @IsEnum(GuideDirection, { message: 'Choose a direction' })
  direction?: GuideDirection;

  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Choose a company' })
  operatorId?: string;

  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Choose a bus' })
  vehicleId?: string;
}

export class CreatePlacementDto extends SlotQueryDto {
  @IsUUID('4', { message: 'Choose an article' })
  articleId: string;

  @IsOptional() @IsBoolean()
  isPinned?: boolean;

  @blankToUndefined() @IsOptional() @IsISO8601({}, { message: 'Start is not a valid date and time' })
  startsAt?: string;

  @blankToUndefined() @IsOptional() @IsISO8601({}, { message: 'End is not a valid date and time' })
  endsAt?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(7) @ArrayUnique() @Type(() => Number) @IsInt({ each: true })
  @Min(0, { each: true }) @Max(6, { each: true })
  daysOfWeek?: number[];

  @blankToUndefined() @IsOptional() @Matches(HHMM, { message: 'Times are HH:MM, 24-hour' })
  timeFrom?: string;

  @blankToUndefined() @IsOptional() @Matches(HHMM, { message: 'Times are HH:MM, 24-hour' })
  timeTo?: string;
}

/** Fields left out stay as they are; an empty string or null clears a schedule field. */
export class UpdatePlacementDto {
  @IsOptional() @IsBoolean()
  isPinned?: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(7) @ArrayUnique() @Type(() => Number) @IsInt({ each: true })
  @Min(0, { each: true }) @Max(6, { each: true })
  daysOfWeek?: number[];

  @blankToNull() @IsOptional() @IsISO8601({}, { message: 'Start is not a valid date and time' })
  startsAt?: string | null;

  @blankToNull() @IsOptional() @IsISO8601({}, { message: 'End is not a valid date and time' })
  endsAt?: string | null;

  @blankToNull() @IsOptional() @Matches(HHMM, { message: 'Times are HH:MM, 24-hour' })
  timeFrom?: string | null;

  @blankToNull() @IsOptional() @Matches(HHMM, { message: 'Times are HH:MM, 24-hour' })
  timeTo?: string | null;
}

export class ReorderPlacementsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ArrayUnique() @IsUUID('4', { each: true })
  ids: string[];
}

export class CopyDirectionDto {
  @IsUUID('4', { message: 'Choose a route' })
  routeId: string;

  @IsIn(['FORWARD', 'REVERSE'], { message: 'Copy from one direction to the other' })
  from: 'FORWARD' | 'REVERSE';

  @blankToUndefined() @IsOptional() @IsUUID('4')
  operatorId?: string;

  @blankToUndefined() @IsOptional() @IsUUID('4')
  vehicleId?: string;
}

export class AssignRoutesDto {
  @IsUUID('4', { message: 'Choose an article' })
  articleId: string;

  @IsArray() @ArrayMinSize(1, { message: 'Choose at least one route' }) @ArrayMaxSize(100) @ArrayUnique()
  @IsUUID('4', { each: true })
  routeIds: string[];

  @IsOptional() @IsEnum(GuideDirection)
  direction?: GuideDirection;
}

export class PreviewQueryDto extends SlotQueryDto {
  /** Any moment, past or future, to check a schedule. Defaults to now. */
  @blankToUndefined() @IsOptional() @IsISO8601({}, { message: 'Choose a valid date and time' })
  at?: string;
}

export class HistoryQueryDto {
  @blankToUndefined() @IsOptional() @IsUUID('4')
  routeId?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  take?: number;
}

export class NoticeQueryDto {
  @blankToUndefined() @IsOptional() @IsUUID('4')
  routeId?: string;
}

export class SaveNoticeDto {
  @IsUUID('4', { message: 'Choose a route' })
  routeId: string;

  @IsOptional() @IsEnum(GuideDirection)
  direction?: GuideDirection;

  @IsOptional() @IsEnum(NoticeSeverity)
  severity?: NoticeSeverity;

  @trim() @IsString() @Length(3, 120, { message: 'Headline must be 3–120 characters' })
  title: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120)
  titleNe?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(600)
  body?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(600)
  bodyNe?: string;

  @blankToUndefined() @IsOptional() @IsISO8601({}, { message: 'Start is not a valid date and time' })
  startsAt?: string;

  @blankToNull() @IsOptional() @IsISO8601({}, { message: 'End is not a valid date and time' })
  endsAt?: string | null;
}

export class RouteBusesQueryDto {
  @IsUUID('4', { message: 'Choose a route' })
  routeId: string;
}
