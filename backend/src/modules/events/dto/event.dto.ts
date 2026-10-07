import { Transform } from 'class-transformer';
import {
  IsBoolean, IsEnum, IsIn, IsISO8601, IsOptional, IsString, IsUrl, IsUUID, Length, MaxLength,
} from 'class-validator';
import { EventCategory, EventStatus } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
/** The whole form is sent on every save, so an empty optional field clears it. */
const blankToNull = () => Transform(({ value }) => (value === '' ? null : value));

/** An event as the control panel's form sends it. Times are ISO, already in UTC. */
export class SaveEventDto {
  @trim() @IsString() @Length(3, 120, { message: 'The name must be 3–120 characters' })
  title: string;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(120)
  titleNe?: string | null;

  @trim() @IsString() @Length(10, 200, { message: 'The one-line summary must be 10–200 characters' })
  summary: string;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(8000)
  description?: string | null;

  @IsEnum(EventCategory, { message: 'Choose a kind of event' })
  category: EventCategory;

  @trim() @IsString() @Length(2, 60, { message: 'The town or city must be 2–60 characters' })
  city: string;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(120)
  venue?: string | null;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(200)
  address?: string | null;

  @blankToNull() @IsOptional() @IsUUID('4', { message: 'Choose a place from the list' })
  destinationId?: string | null;

  @IsISO8601({}, { message: 'When it starts is not a valid date and time' })
  startsAt: string;

  @blankToNull() @IsOptional() @IsISO8601({}, { message: 'When it ends is not a valid date and time' })
  endsAt?: string | null;

  @IsOptional() @IsBoolean()
  allDay?: boolean;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(40)
  priceLabel?: string | null;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(120)
  organiser?: string | null;

  @blankToNull() @trim() @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'The link must start with https:// (or http://)' })
  @MaxLength(500)
  url?: string | null;

  @blankToNull() @IsOptional() @IsString() @MaxLength(500)
  imageUrl?: string | null;

  @IsOptional() @IsEnum(EventStatus)
  status?: EventStatus;

  @IsOptional() @IsBoolean()
  isFeatured?: boolean;
}

export class EventListQueryDto {
  /** Upcoming (not yet over, the default), past, or everything. */
  @IsOptional() @IsIn(['upcoming', 'past', 'all'])
  when?: 'upcoming' | 'past' | 'all';

  @IsOptional() @IsEnum(EventStatus)
  status?: EventStatus;

  @trim() @IsOptional() @IsString() @MaxLength(80)
  q?: string;
}
