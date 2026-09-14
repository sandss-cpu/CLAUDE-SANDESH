import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min,
} from 'class-validator';
import { ContentStatus, Language } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ArticleQueryDto extends PaginationDto {
  @IsOptional() @IsString() categorySlug?: string;
  @IsOptional() @IsString() routeId?: string;
  @IsOptional() @IsString() destinationSlug?: string;
  @IsOptional() @IsString() issueId?: string;
  @IsOptional() @IsEnum(Language) language?: Language;
  @IsOptional() @Type(() => Boolean) @IsBoolean() featuredOnly?: boolean;
  @IsOptional() @IsString() q?: string;
}

/** Editorial listing: every status, not just PUBLISHED — powers the admin panel. */
export class AdminArticleQueryDto extends ArticleQueryDto {
  @IsOptional() @IsEnum(ContentStatus) status?: ContentStatus;
}

export class CreateArticleDto {
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() subtitle?: string;
  @IsString() @Length(20, 100_000) body: string;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsString() audioUrl?: string;
  @IsOptional() @IsEnum(Language) language?: Language;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() issueId?: string;
  @IsOptional() @IsBoolean() isSponsored?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsString() sponsorBusinessId?: string;
  /** Corridors this article should appear on when a QR is scanned. */
  @IsOptional() @IsArray() @IsString({ each: true }) routeIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) destinationIds?: string[];
}

export class UpdateArticleDto extends CreateArticleDto {
  @IsOptional() @IsString() title: string;
  @IsOptional() @IsString() body: string;
  @IsOptional() @IsEnum(ContentStatus) status?: ContentStatus;
}

export class CreateIssueDto {
  @Type(() => Number) @IsInt() @Min(1) number: number;
  @IsString() @Length(3, 200) title: string;
  @IsOptional() @IsString() titleNe?: string;
  @IsOptional() @IsString() strapline?: string;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsString() season?: string;
}

/** Editorial elevation: promote a community post into the magazine. */
export class ElevatePostDto {
  @IsString() postId: string;
  @IsOptional() @IsString() issueId?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) routeIds?: string[];
  @IsOptional() @IsString() editorNote?: string;
}
