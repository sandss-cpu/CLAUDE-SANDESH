import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min, ValidateNested,
} from 'class-validator';
import { BudgetStyle } from '@prisma/client';

class StopDto {
  @IsString() @Length(1, 160) name: string;
  @IsOptional() @IsString() time?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @Type(() => Number) @IsInt() costNpr?: number;
  @IsOptional() @IsString() placeId?: string;
  @IsOptional() @IsString() businessId?: string;
}

class DayDto {
  @Type(() => Number) @IsInt() @Min(1) dayNumber: number;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => StopDto) stops?: StopDto[];
}

export class CreateItineraryDto {
  @IsString() @Length(2, 160) title: string;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsEnum(BudgetStyle) budgetStyle?: BudgetStyle;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DayDto) days?: DayDto[];
  @IsOptional() @IsString() sourceArticleId?: string;
}

export class UpdateItineraryDto extends CreateItineraryDto {
  @IsOptional() @IsString() title: string;
}

/** Auto-suggest: build a draft plan from days, budget and interest. */
export class SuggestItineraryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(30) days: number;
  @IsOptional() @IsEnum(BudgetStyle) budgetStyle?: BudgetStyle;
  @IsOptional() @IsString() destinationSlug?: string;
  @IsOptional() @IsString() month?: string;
}

/** One-tap conversion of an article into an editable trip. */
export class FromArticleDto {
  @IsString() articleSlug: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) days?: number;
}
