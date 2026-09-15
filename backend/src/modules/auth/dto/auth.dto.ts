import {
  IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength,
} from 'class-validator';
import { Language } from '@prisma/client';

/** Nepali mobile numbers: 98/97/96 + 8 digits. Accepts an optional +977 prefix. */
const NP_PHONE = /^(?:\+?977)?(9[678]\d{8})$/;

export class RequestOtpDto {
  @IsString() @Matches(NP_PHONE, { message: 'Enter a valid Nepali mobile number' })
  phone: string;
}

export class VerifyOtpDto {
  @IsString() @Matches(NP_PHONE, { message: 'Enter a valid Nepali mobile number' })
  phone: string;

  @IsString() @Length(6, 6, { message: 'The code is 6 digits' })
  code: string;

  @IsOptional() @IsString() @Length(2, 60)
  name?: string;

  /** Anonymous session id from the PWA, so guest bookmarks and drafts survive signup. */
  @IsOptional() @IsString()
  guestSessionId?: string;

  @IsOptional() @IsEnum(Language)
  language?: Language;
}

export class MfaCodeDto {
  @IsString() @Length(6, 6, { message: 'The authenticator code is 6 digits' })
  code: string;
}

/** Exchanges an mfa_pending token plus a TOTP code for real session tokens. */
export class MfaVerifyDto {
  @IsString() @IsNotEmpty() challengeToken: string;

  @IsString() @Length(6, 6, { message: 'The authenticator code is 6 digits' })
  code: string;
}

export class RefreshDto {
  @IsString() @IsNotEmpty()
  refreshToken: string;
}

const PASSWORD_RULE = { message: 'Use at least 8 characters for your password' };

/** Which page an emailed link opens: the traveller sign-in or the bus owner portal. */
export const LINK_APPS = ['traveller', 'owner'] as const;
export type LinkApp = (typeof LINK_APPS)[number];

export class EmailRegisterDto {
  @IsString() @Length(2, 60, { message: 'Enter your name (2–60 characters)' })
  name: string;

  @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(254)
  email: string;

  @IsString() @Length(8, 128, PASSWORD_RULE)
  password: string;

  @IsOptional() @IsIn(LINK_APPS)
  app?: LinkApp;
}

export class EmailLoginDto {
  @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(254)
  email: string;

  @IsString() @Length(1, 128)
  password: string;
}

export class EmailOnlyDto {
  @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(254)
  email: string;

  @IsOptional() @IsIn(LINK_APPS)
  app?: LinkApp;
}

export class TokenDto {
  @IsString() @Length(20, 200)
  token: string;
}

export class PasswordResetDto {
  @IsString() @Length(20, 200)
  token: string;

  @IsString() @Length(8, 128, PASSWORD_RULE)
  password: string;
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalisePhone(raw: string): string {
  const m = raw.match(NP_PHONE);
  return m ? m[1] : raw.replace(/\D/g, '');
}
