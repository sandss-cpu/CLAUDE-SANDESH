import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsEnum, IsInt, IsLatitude, IsLongitude, IsOptional,
  IsString, Length, Max, Min,
} from 'class-validator';
import { BusinessCategory, BusinessTier, LeadType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class BusinessQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(BusinessCategory) category?: BusinessCategory;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() destinationSlug?: string;
  @IsOptional() @IsString() routeId?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) radiusKm?: number;
  @IsOptional() @IsEnum(BusinessTier) tier?: BusinessTier;
}

export class CreateBusinessDto {
  @IsString() @Length(2, 160) name: string;
  @IsEnum(BusinessCategory) category: BusinessCategory;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() destinationId?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsOptional() @IsString() viber?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() priceRange?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) photoUrls?: string[];
}

export class UpdateBusinessDto extends CreateBusinessDto {
  @IsOptional() @IsString() name: string;
  @IsOptional() @IsEnum(BusinessCategory) category: BusinessCategory;
}

export class VerifyBusinessDto {
  @IsString() @Length(5, 500) verificationNote: string;
  @IsOptional() @IsEnum(BusinessTier) tier?: BusinessTier;
}

export class TargetRoutesDto {
  @IsArray() @IsString({ each: true }) routeIds: string[];
}

export class CreateCouponDto {
  @IsString() @Length(2, 160) title: string;
  @IsOptional() @IsString() description?: string;
  @IsString() @Length(2, 60) discountLabel: string;
  @IsDateString() validTo: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxRedemptions?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perUserLimit?: number;
}

export class LeadDto {
  @IsEnum(LeadType) type: LeadType;
  @IsOptional() @IsString() routeId?: string;
  @IsOptional() @IsString() sessionId?: string;
}

export class ReviewDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating: number;
  @IsOptional() @IsString() @Length(0, 2000) body?: string;
  /** Ties the review to a redeemed coupon, which is what makes it "verified". */
  @IsOptional() @IsString() redemptionId?: string;
}
