import { Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, Length, ValidateNested,
} from 'class-validator';
import { ContentStatus, ModerationStatus, PostTemplate } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

class PhotoDto {
  @IsString() url: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
}

/**
 * Two-tap posting (spec Module 2): a photo, a caption and a location is a
 * valid post. Only `title` and `body` are required, and body may be short.
 */
export class CreatePostDto {
  @IsString() @Length(2, 200) title: string;
  @IsString() @Length(1, 50_000) body: string;
  @IsOptional() @IsEnum(PostTemplate) template?: PostTemplate;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsString() destinationId?: string;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsString() locationName?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PhotoDto)
  photos?: PhotoDto[];
  /** Client-generated id so an offline draft syncs exactly once. */
  @IsOptional() @IsString() clientDraftId?: string;
}

export class UpdatePostDto extends CreatePostDto {
  @IsOptional() @IsString() title: string;
  @IsOptional() @IsString() body: string;
}

export class PostQueryDto extends PaginationDto {
  @IsOptional() @IsString() authorId?: string;
  @IsOptional() @IsString() destinationSlug?: string;
  @IsOptional() @IsEnum(PostTemplate) template?: PostTemplate;
  @IsOptional() @IsEnum(ModerationStatus) moderation?: ModerationStatus;
  @IsOptional() @IsEnum(ContentStatus) status?: ContentStatus;
}
