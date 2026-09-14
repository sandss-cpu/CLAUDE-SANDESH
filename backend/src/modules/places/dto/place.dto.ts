import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString } from 'class-validator';
import { PlaceType } from '@prisma/client';

export class NearbyQueryDto {
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
  @IsOptional() @Type(() => Number) @IsNumber() radiusKm?: number = 5;
  @IsOptional() @IsArray() @IsEnum(PlaceType, { each: true }) types?: PlaceType[];
  @IsOptional() @Type(() => Number) @IsNumber() limit?: number = 50;
}

export class CreatePlaceDto {
  @IsString() name: string;
  @IsOptional() @IsString() nameNe?: string;
  @IsEnum(PlaceType) type: PlaceType;
  @Type(() => Number) @IsLatitude() latitude: number;
  @Type(() => Number) @IsLongitude() longitude: number;
  @IsOptional() @Type(() => Number) altitudeM?: number;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() destinationId?: string;
  @IsOptional() @IsString() notes?: string;
}
