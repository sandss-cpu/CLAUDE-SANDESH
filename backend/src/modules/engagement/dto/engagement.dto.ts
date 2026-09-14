import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ReactionType, TargetType } from '@prisma/client';

export class ReactDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() targetId: string;
  @IsOptional() @IsEnum(ReactionType) type?: ReactionType;
}

export class BookmarkDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() targetId: string;
}

export class CommentDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() targetId: string;
  @IsString() @Length(1, 2000) body: string;
  @IsOptional() @IsString() parentId?: string;
}
