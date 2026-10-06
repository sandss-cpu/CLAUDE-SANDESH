import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min } from 'class-validator';
import { EnquiryKind, EnquiryStatus, PackageKind, PackageStatus } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** Every public form has a hidden field people never fill in; anything in it is a bot. */
class Honeypot {
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class SiteLeadDto extends Honeypot {
  @IsString() @Length(1, 120) businessSlug: string;
  @trim() @IsString() @Length(2, 80, { message: 'Tell them your name' }) name: string;
  @trim() @IsString() @Length(5, 120, { message: 'Give a phone number or email address they can answer' }) contact: string;
  @trim() @IsString() @Length(5, 2000, { message: 'Write a short message' }) message: string;
}

export class SiteEnquiryDto extends Honeypot {
  @IsEnum(EnquiryKind) kind: EnquiryKind;
  @trim() @IsString() @Length(2, 80, { message: 'Tell us your name' }) name: string;
  @trim() @IsString() @Length(5, 120, { message: 'Give a phone number or email address' }) contact: string;
  @trim() @IsOptional() @IsString() @MaxLength(120) organisation?: string;
  @trim() @IsString() @Length(5, 4000, { message: 'Write a short message' }) message: string;
}

export class NewsletterDto extends Honeypot {
  @trim() @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(254) email: string;
  @IsOptional() @IsString() @MaxLength(60) source?: string;
}

export class TokenDto {
  @IsString() @Length(16, 128) token: string;
}

export class PackageDto {
  @IsUUID() businessId: string;
  @IsEnum(PackageKind) kind: PackageKind;
  @IsString() startsAt: string;
  @IsString() endsAt: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) pricePaisa?: number | null;
  @IsOptional() @IsEnum(PackageStatus) status?: PackageStatus;
  @trim() @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class UpdatePackageDto {
  @IsOptional() @IsEnum(PackageKind) kind?: PackageKind;
  @IsOptional() @IsString() startsAt?: string;
  @IsOptional() @IsString() endsAt?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) pricePaisa?: number | null;
  @IsOptional() @IsEnum(PackageStatus) status?: PackageStatus;
  @trim() @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
}

export class EnquiryStatusDto {
  @IsEnum(EnquiryStatus) status: EnquiryStatus;
}

export class ListQueryDto {
  @IsOptional() @IsIn(['NEW', 'HANDLED', 'PROPOSED', 'ACTIVE', 'PAUSED', 'ENDED', 'CANCELLED']) status?: string;
  @IsOptional() @IsUUID() businessId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class MonthQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/, { message: 'Choose a month as YYYY-MM' }) month?: string;
}

/** Published articles as the website sees them: all, only those on it, or only those taken off. */
export class WebsiteArticlesQueryDto {
  @trim() @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['on', 'off']) show?: 'on' | 'off';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

export class WebsiteArticleDto {
  @IsOptional() @IsBoolean() onWebsite?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
}
