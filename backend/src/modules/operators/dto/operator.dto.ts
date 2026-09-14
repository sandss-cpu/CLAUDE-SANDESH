import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateOperatorDto {
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() contactPhone?: string;
}

export class CreateVehicleDto {
  @IsString() operatorId: string;
  @IsString() @Length(2, 40) plateNo: string;
  @IsOptional() @IsString() routeId?: string;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @Type(() => Number) @IsInt() seatCount?: number;
}

/** Per-vehicle passenger feedback — data no Nepali operator currently holds. */
export class RideFeedbackDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() routeId?: string;
  @IsString() sessionId: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) cleanliness: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) driving: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) punctuality: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) staff: number;
  @IsOptional() @IsString() @Length(0, 1000) comment?: string;
}

export class LostItemDto {
  @IsOptional() @IsString() vehicleId?: string;
  @IsOptional() @IsString() seatNo?: string;
  @IsString() @Length(3, 500) description: string;
  @IsString() @Length(7, 20) contactPhone: string;
}

export class CreateRouteDto {
  @IsString() @Length(2, 20) code: string;
  @IsString() @Length(2, 120) name: string;
  @IsOptional() @IsString() nameNe?: string;
  @IsString() startPlace: string;
  @IsString() endPlace: string;
  @IsOptional() @Type(() => Number) @IsInt() distanceKm?: number;
  @IsOptional() @Type(() => Number) typicalHours?: number;
  @IsOptional() @IsString() description?: string;
}
