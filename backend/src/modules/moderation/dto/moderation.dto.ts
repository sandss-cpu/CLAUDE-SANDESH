import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ModerationAct, ReportReason, TargetType } from '@prisma/client';

export class CreateReportDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() @Length(1, 64) targetId: string;
  @IsEnum(ReportReason, { message: 'Choose a reason for the report' }) reason: ReportReason;
  @IsOptional() @IsString() @Length(0, 1000) detail?: string;
  /** The reader's device session; required when not signed in. */
  @IsOptional() @IsString() @Length(8, 64) sessionId?: string;
}

export class ModerateDto {
  @IsEnum(TargetType) targetType: TargetType;
  @IsString() targetId: string;
  @IsEnum(ModerationAct) action: ModerationAct;
  @IsOptional() @IsString() @Length(0, 1000) note?: string;
}
