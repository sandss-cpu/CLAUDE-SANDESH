import { Transform } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsLatitude, IsLongitude, IsOptional, IsString, IsUrl, IsUUID,
  Length, Matches, MaxLength, ValidateIf,
} from 'class-validator';
import { BusinessCategory } from '@prisma/client';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
/** The whole form is sent on every save, so an empty optional field clears it. */
const blankToNull = () => Transform(({ value }) => (value === '' ? null : value));
/** Read as sent: the API's implicit conversion would already have made "" into 0. */
const numberOrNull = () => Transform(({ obj, key }) => {
  const sent = obj[key];
  return sent === undefined ? undefined : sent === '' || sent === null ? null : Number(sent);
});
const PHONE = /^\+?[0-9][0-9 ()-]{5,19}$/;

/** A listing as the control panel's form sends it (Website → Listings). */
export class AdminListingDto {
  @trim() @IsString() @Length(2, 160, { message: 'The name must be 2–160 characters' })
  name: string;

  @IsEnum(BusinessCategory, { message: 'Choose what kind of business it is' })
  category: BusinessCategory;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(2000)
  description?: string | null;

  @blankToNull() @IsOptional() @IsUUID('4', { message: 'Choose a place from the list' })
  destinationId?: string | null;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(80)
  district?: string | null;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(200)
  address?: string | null;

  @numberOrNull() @IsOptional() @IsLatitude({ message: 'Latitude is a number between -90 and 90, like 27.9431' })
  latitude?: number | null;

  @numberOrNull() @IsOptional() @IsLongitude({ message: 'Longitude is a number between -180 and 180, like 84.4164' })
  longitude?: number | null;

  @blankToNull() @trim() @IsOptional() @Matches(PHONE, { message: 'The phone number can have digits, spaces, brackets, hyphens and a leading +' })
  phone?: string | null;

  @blankToNull() @trim() @IsOptional() @Matches(PHONE, { message: 'The WhatsApp number can have digits, spaces, brackets, hyphens and a leading +' })
  whatsapp?: string | null;

  @blankToNull() @trim() @IsOptional() @Matches(PHONE, { message: 'The Viber number can have digits, spaces, brackets, hyphens and a leading +' })
  viber?: string | null;

  @blankToNull() @trim() @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { message: 'The website must start with https:// (or http://)' })
  @MaxLength(300)
  website?: string | null;

  @blankToNull() @trim() @IsOptional() @IsString() @MaxLength(60)
  priceRange?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  amenities?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(12, { message: 'Twelve photos at most' }) @IsString({ each: true })
  photoUrls?: string[];

  /** The business owner's Batoma account, so they can manage the listing in the partner area. Empty: Batoma manages it. */
  @blankToNull() @trim() @IsOptional() @IsEmail({}, { message: "Give the owner's account email, or leave it empty" })
  ownerEmail?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

/** Adding one: Batoma usually checked the business already, so it can be verified at once. */
export class CreateAdminListingDto extends AdminListingDto {
  @IsBoolean()
  verify: boolean;

  @ValidateIf((o) => o.verify === true)
  @trim() @IsString() @Length(5, 500, { message: 'Say how Batoma checked it (5–500 characters)' })
  verificationNote?: string;
}
