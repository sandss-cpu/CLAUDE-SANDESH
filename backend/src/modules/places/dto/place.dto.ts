import { Transform, Type } from 'class-transformer';
import {
  IsArray, IsEnum, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, MaxLength,
} from 'class-validator';
import { PlaceType } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const blankToUndefined = () => Transform(({ value }) => (value === '' || value === null ? undefined : value));

export class NearbyQueryDto {
  @Type(() => Number) @IsLatitude() lat: number;
  @Type(() => Number) @IsLongitude() lng: number;
  @IsOptional() @Type(() => Number) @IsNumber() radiusKm?: number = 5;
  @IsOptional() @IsArray() @IsEnum(PlaceType, { each: true }) types?: PlaceType[];
  @IsOptional() @Type(() => Number) @IsNumber() limit?: number = 50;
}

/** A town or area an itinerary can be written for: Pokhara, Sauraha, Bandipur. */
export class CreateDestinationDto {
  @trim() @IsString() @Length(2, 120, { message: 'Enter the name of the place' })
  name: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(120)
  nameNe?: string;

  @trim() @IsString() @Length(2, 80, { message: 'Enter the district' })
  district: string;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(80)
  province?: string;

  @Type(() => Number) @IsLatitude({ message: 'Latitude looks wrong' })
  latitude: number;

  @Type(() => Number) @IsLongitude({ message: 'Longitude looks wrong' })
  longitude: number;

  @blankToUndefined() @trim() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @blankToUndefined() @IsOptional() @IsString() @MaxLength(500)
  heroImageUrl?: string;
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
