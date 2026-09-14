import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { Language, Role } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/** Admin directory search: by name, phone or email, filterable by role. */
export class AdminUserQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @Type(() => Boolean) @IsBoolean() suspendedOnly?: boolean;
}

export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @IsString() avatarUrl?: string;
  @IsOptional() @IsString() @Length(0, 280) bio?: string;
  @IsOptional() @IsString() homeDistrict?: string;
  @IsOptional() @IsEnum(Language) language?: Language;
}

export class UpdatePrivacyDto {
  @IsOptional() @IsBoolean() hideExactLocation?: boolean;
  /** Solo-traveller safety: delay geotagged publishing by N hours. */
  @IsOptional() @IsInt() @Min(0) @Max(168) publishDelayHours?: number;
}

export class SetRoleDto {
  @IsEnum(Role) role: Role;
}
