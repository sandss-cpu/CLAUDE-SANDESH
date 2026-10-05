import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { IncomeSourceKind } from '@prisma/client';
import { MAX_ENTRY_PAISA } from '../money';

const KTM_DAY = /^\d{4}-\d{2}-\d{2}$/;
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const blankToNull = () => Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value));

export class FinanceSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() managersSeeTotals?: boolean;
  /** Turning income records on needs a fresh code from the owner's authenticator. */
  @IsOptional() @IsString() @Length(6, 6, { message: 'The authenticator code is 6 digits' }) code?: string;
}

export class SourceDto {
  @trim() @IsString() @Length(2, 60, { message: 'Name the source in 2 to 60 characters' }) name: string;
  @IsOptional() @IsEnum(IncomeSourceKind) kind?: IncomeSourceKind;
}

export class UpdateSourceDto {
  @IsOptional() @trim() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @IsEnum(IncomeSourceKind) kind?: IncomeSourceKind;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) position?: number;
}

/** One row of the daily sheet. Amounts are paisa; the page converts from rupees. */
export class SheetRowDto {
  @IsOptional() @IsUUID() id?: string;
  @IsUUID('4', { message: 'Choose where the money came from' }) sourceId: string;
  @IsOptional() @blankToNull() @IsUUID() tripId?: string | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(100_000) ticketsSold: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) seatsSold?: number | null;
  @Type(() => Number) @IsInt({ message: 'Amounts are whole paisa' }) @Min(0) @Max(MAX_ENTRY_PAISA) grossPaisa: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(MAX_ENTRY_PAISA) feesPaisa?: number;
  @IsOptional() @blankToNull() @trim() @IsString() @MaxLength(120) reference?: string | null;
  @IsOptional() @blankToNull() @trim() @IsString() @MaxLength(500) note?: string | null;
}

export class SaveSheetDto {
  @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => SheetRowDto) rows: SheetRowDto[];
}

export class DayQueryDto {
  @IsOptional() @Matches(KTM_DAY, { message: 'Dates must be written as YYYY-MM-DD' }) date?: string;
}

export class ReportQueryDto {
  @IsOptional() @Matches(KTM_DAY, { message: 'Dates must be written as YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(KTM_DAY, { message: 'Dates must be written as YYYY-MM-DD' }) to?: string;
  @IsOptional() @IsIn(['bus', 'route', 'driver']) groupBy?: 'bus' | 'route' | 'driver';
  @IsOptional() @IsIn(['day', 'week', 'month']) bucket?: 'day' | 'week' | 'month';
}

/** The file arrives as multipart; these fields come with it as text. */
export class ImportFormDto {
  @IsUUID('4', { message: 'Choose which source this file is from' }) sourceId: string;
  /** JSON of ImportMapping; without it the source's saved mapping, or a guess from the headers. */
  @IsOptional() @IsString() @MaxLength(4000) mapping?: string;
}
