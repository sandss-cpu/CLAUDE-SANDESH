import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString, Length } from 'class-validator';

export class SosDto {
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsString() @Length(0, 500) message?: string;
  /** DATA when online; SMS when the app fell back to a text message. */
  @IsOptional() @IsString() channel?: string;
}

export class EmergencyContactDto {
  @IsString() @Length(2, 60) name: string;
  @IsString() @Length(7, 20) phone: string;
}
