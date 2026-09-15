import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length } from 'class-validator';

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
