import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ModerationAct, ReportReason, TargetType } from '@prisma/client';

export class CreateReportDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() targetId: string;
  @IsEnum(ReportReason) reason: ReportReason;
  @IsOptional() @IsString() @Length(0, 1000) detail?: string;
}

export class ModerateDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() targetId: string;
  @IsEnum(ModerationAct) action: ModerationAct;
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
}
