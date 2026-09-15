import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber,
  IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import {
  BusDocumentType, BusStatus, DriverRole, IncidentKind, IncidentSeverity, MaintenanceKind,
  OperatorMemberRole, OperatorVerification, ReportReason,
} from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
/** An empty form field clears an optional value instead of failing validation. */
const blankToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));

const PHONE = /^\+?[0-9][0-9\s-]{6,19}$/;
const PLATE = /^[\p{L}\p{N}][\p{L}\p{N} .\-/]*$/u;

export const BUS_TYPES = ['TOURIST_DELUXE', 'SOFA_SEATER', 'AC_DELUXE', 'SLEEPER', 'MICRO_BUS', 'HIACE', 'LOCAL', 'MINI_BUS', 'OTHER'] as const;
export const AMENITIES = ['AC', 'WIFI', 'CHARGING', 'RECLINING_SEATS', 'TOILET', 'WATER', 'TV', 'CCTV', 'FIRST_AID', 'GPS_TRACKING', 'LUGGAGE_RACK', 'BLANKETS'] as const;

// ---------------- companies ----------------

export class CreateCompanyDto {
  @trim() @IsString() @Length(2, 120, { message: 'Company name must be 2–120 characters' })
  name: string;

  @trim() @IsString() @Matches(PHONE, { message: 'Enter a contact phone number' })
  contactPhone: string;

  @blankToUndefined() @trim() @IsOptional() @IsEmail({}, { message: 'Enter a valid contact email' }) @MaxLength(254)
  contactEmail?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(40)
  registrationNo?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(300)
  logoUrl?: string;
}

export class UpdateCompanyDto {
  @trim() @IsOptional() @IsString() @Length(2, 120, { message: 'Company name must be 2–120 characters' })
  name?: string;

  @trim() @IsOptional() @IsString() @Matches(PHONE, { message: 'Enter a contact phone number' })
  contactPhone?: string;

  @trim() @IsOptional() @IsString() @MaxLength(254)
  contactEmail?: string;

  @trim() @IsOptional() @IsString() @MaxLength(40)
  registrationNo?: string;

  @trim() @IsOptional() @IsString() @MaxLength(200)
  address?: string;

  @trim() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @IsOptional() @IsString() @MaxLength(300)
  logoUrl?: string;
}

export class AddMemberDto {
  @trim() @IsEmail({}, { message: 'Enter the email of their Bato account' }) @MaxLength(254)
  email: string;

  @IsEnum(OperatorMemberRole)
  role: OperatorMemberRole;
}

// ---------------- buses ----------------

export class CreateBusDto {
  @trim() @IsString() @Length(4, 30, { message: 'Enter the registration number as it appears on the plate' })
  @Matches(PLATE, { message: 'Registration numbers use letters, numbers, spaces and hyphens only' })
  registrationNo: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60)
  label?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120)
  seatCount?: number;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(40)
  make?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(40)
  model?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1970) @Max(2100)
  year?: number;

  @blankToUndefined() @IsOptional() @IsIn(BUS_TYPES)
  busType?: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(30)
  colour?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(AMENITIES.length) @IsIn(AMENITIES, { each: true })
  amenities?: string[];

  @blankToUndefined() @IsOptional() @IsUUID()
  routeId?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(300)
  photoUrl?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5_000_000)
  odometerKm?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(500) @Max(100_000)
  serviceIntervalKm?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(730)
  serviceIntervalDays?: number;

  @IsOptional() @IsEnum(BusStatus)
  status?: BusStatus;
}

export class UpdateBusDto {
  @trim() @IsOptional() @IsString() @Length(4, 30, { message: 'Enter the registration number as it appears on the plate' })
  @Matches(PLATE, { message: 'Registration numbers use letters, numbers, spaces and hyphens only' })
  registrationNo?: string;

  @trim() @IsOptional() @IsString() @MaxLength(60)
  label?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120)
  seatCount?: number;

  @trim() @IsOptional() @IsString() @MaxLength(40)
  make?: string;

  @trim() @IsOptional() @IsString() @MaxLength(40)
  model?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1970) @Max(2100)
  year?: number;

  @blankToUndefined() @IsOptional() @IsIn(BUS_TYPES)
  busType?: string;

  @trim() @IsOptional() @IsString() @MaxLength(30)
  colour?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(AMENITIES.length) @IsIn(AMENITIES, { each: true })
  amenities?: string[];

  /** An empty string takes the bus off its route. */
  @IsOptional() @IsString() @MaxLength(40)
  routeId?: string;

  @IsOptional() @IsString() @MaxLength(300)
  photoUrl?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5_000_000)
  odometerKm?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(500) @Max(100_000)
  serviceIntervalKm?: number;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(730)
  serviceIntervalDays?: number;

  @IsOptional() @IsEnum(BusStatus)
  status?: BusStatus;
}

export class ArchiveBusDto {
  @IsBoolean() archived: boolean;
}

export class BusListQueryDto {
  @blankToUndefined() @IsOptional() @IsString() @MaxLength(60) q?: string;
  @blankToUndefined() @IsOptional() @IsEnum(BusStatus) status?: BusStatus;
  @blankToUndefined() @IsOptional() @IsIn(['true', 'false']) archived?: string;
  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
}

// ---------------- maintenance ----------------

export class MaintenanceDto {
  @IsEnum(MaintenanceKind) kind: MaintenanceKind;

  @IsDateString({}, { message: 'Enter the service date' }) servicedAt: string;

  @Type(() => Number) @IsInt({ message: 'Enter the kilometre reading' }) @Min(0) @Max(5_000_000)
  odometerKm: number;

  @trim() @IsString() @Length(2, 120, { message: 'Give the work a short title' })
  title: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120) workshop?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  costNpr?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(80, { each: true })
  partsReplaced?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  photos?: string[];

  @blankToUndefined() @IsOptional() @IsDateString() nextDueDate?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5_000_000)
  nextDueKm?: number;
}

// ---------------- breakdowns ----------------

export class IncidentDto {
  @IsEnum(IncidentKind) kind: IncidentKind;
  @IsEnum(IncidentSeverity) severity: IncidentSeverity;
  @IsDateString({}, { message: 'Enter when it happened' }) occurredAt: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(160) location?: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5_000_000)
  odometerKm?: number;

  @trim() @IsString() @Length(5, 2000, { message: 'Describe what happened (at least 5 characters)' })
  description: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  photos?: string[];

  @blankToUndefined() @IsOptional() @IsUUID() driverId?: string;
}

export class ResolveIncidentDto {
  @trim() @IsString() @Length(2, 1000, { message: 'Say how it was fixed' })
  resolutionNote: string;

  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  repairCostNpr?: number;

  /** Also writes the repair into the service history. */
  @IsOptional() @IsBoolean() addToServiceHistory?: boolean;
}

// ---------------- documents ----------------

export class DocumentDto {
  @IsEnum(BusDocumentType) type: BusDocumentType;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(60) number?: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120) issuer?: string;
  @blankToUndefined() @IsOptional() @IsDateString() issuedAt?: string;
  @blankToUndefined() @IsOptional() @IsDateString() expiresAt?: string;
  @blankToUndefined() @IsOptional() @IsString() @MaxLength(300) photoUrl?: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// ---------------- crew ----------------

export class DriverDto {
  @trim() @IsString() @Length(2, 80, { message: 'Enter their name' }) name: string;
  @trim() @IsString() @Matches(PHONE, { message: 'Enter their phone number' }) phone: string;
  @IsOptional() @IsEnum(DriverRole) role?: DriverRole;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(40) licenceNumber?: string;
  @blankToUndefined() @IsOptional() @IsDateString() licenceExpiresAt?: string;
  @blankToUndefined() @IsOptional() @IsString() @MaxLength(300) photoUrl?: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class AssignDriverDto {
  @IsUUID() driverId: string;
}

// ---------------- fuel ----------------

export class FuelDto {
  @IsDateString({}, { message: 'Enter the fill-up date' }) filledAt: string;

  @Type(() => Number) @IsInt({ message: 'Enter the kilometre reading' }) @Min(0) @Max(5_000_000)
  odometerKm: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the litres filled' }) @Min(0.5) @Max(2000)
  litres: number;

  @Type(() => Number) @IsInt({ message: 'Enter the amount paid in rupees' }) @Min(0) @Max(10_000_000)
  costNpr: number;

  @IsOptional() @IsBoolean() fullTank?: boolean;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120) station?: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

// ---------------- reviews ----------------

export class SubmitReviewDto {
  @Type(() => Number) @IsInt({ message: 'Choose an overall rating' }) @Min(1) @Max(5)
  overall: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) cleanliness?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) driving?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) punctuality?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) staff?: number;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000) suggestion?: string;
  @blankToUndefined() @IsOptional() @IsDateString() tripDate?: string;

  /** Proof of scanning the sticker on this bus, from POST /buses/scan/:code. */
  @blankToUndefined() @IsOptional() @IsString() @MaxLength(1000) scanToken?: string;

  /** The device session; required when not signed in. */
  @blankToUndefined() @IsOptional() @IsString() @Length(8, 64) sessionId?: string;
}

export class ScanDto {
  @IsOptional() @IsString() @Length(8, 64) sessionId?: string;
}

export class ReplyDto {
  /** Empty removes the reply. */
  @trim() @IsString() @MaxLength(1000) reply: string;
}

export class OwnerReportDto {
  @IsEnum(ReportReason, { message: 'Choose a reason' }) reason: ReportReason;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000) detail?: string;
}

export class ReviewListQueryDto {
  @blankToUndefined() @IsOptional() @IsUUID() busId?: string;
  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @blankToUndefined() @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(730) days?: number;
}

// ---------------- admin ----------------

export class VerificationDto {
  @IsEnum(OperatorVerification) status: OperatorVerification;
  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AdminCompanyQueryDto {
  @blankToUndefined() @IsOptional() @IsEnum(OperatorVerification) status?: OperatorVerification;
  @blankToUndefined() @IsOptional() @IsString() @MaxLength(60) q?: string;
}
