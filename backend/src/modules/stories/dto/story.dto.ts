import { Transform } from 'class-transformer';
import { Equals, IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { SubmissionStatus } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const blankToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));

/** A story sent from the website's "Write a trip" form, forwarded with the site's key. */
export class SiteStoryDto {
  @trim() @IsString() @Length(2, 80, { message: 'Your name must be 2–80 characters' })
  name: string;

  @trim() @IsEmail({}, { message: 'Give an email address we can reach you at' }) @MaxLength(254)
  email: string;

  @trim() @IsString() @Length(5, 120, { message: 'The title must be 5–120 characters' })
  title: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(80)
  place?: string;

  @trim() @IsString() @Length(300, 20000, { message: 'Your story must be 300–20,000 characters (about 50 to 3,000 words)' })
  story: string;

  @Equals(true, { message: 'Confirm that this is your own writing' })
  ownWork: boolean;

  /** The honeypot: people never fill it in. */
  @IsOptional() @IsString() @MaxLength(200)
  website?: string;
}

export class StoryListQueryDto {
  @blankToUndefined() @IsOptional() @IsEnum(SubmissionStatus)
  status?: SubmissionStatus;
}

export class FeatureStoryDto {
  @blankToUndefined() @IsOptional() @IsUUID('4', { message: 'Choose a section' })
  categoryId?: string;
}

export class DeclineStoryDto {
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000)
  note?: string;
}
