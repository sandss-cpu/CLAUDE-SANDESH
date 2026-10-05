import { Body, Controller, Delete, Get, Ip, Param, ParseEnumPipe, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Role, VerificationDocKind } from '@prisma/client';
import { memoryStorage } from 'multer';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { VerificationService } from './verification.service';

const UPLOAD = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 3 } });
const actor = (u: AuthUser) => ({ id: u.id, role: u.role as Role });

/** The same four routes for a company (its owners) and a business (its owner). */
abstract class OwnDocuments {
  protected abstract readonly target: 'company' | 'business';
  constructor(protected docs: VerificationService) {}

  @Get()
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.docs.list((await this.docs.ownerOf(this.target, id, actor(u))).owner);
  }

  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @Post()
  @UseInterceptors(UPLOAD)
  async upload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('kind', new ParseEnumPipe(VerificationDocKind)) kind: VerificationDocKind,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() u: AuthUser, @Ip() ip: string,
  ) {
    const { owner, name } = await this.docs.ownerOf(this.target, id, actor(u));
    return this.docs.upload(owner, name, kind, file, actor(u), ip);
  }

  @Get(':docId/link')
  async link(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @CurrentUser() u: AuthUser) {
    return this.docs.link((await this.docs.ownerOf(this.target, id, actor(u))).owner, docId);
  }

  @Delete(':docId')
  async remove(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    const { owner, name } = await this.docs.ownerOf(this.target, id, actor(u));
    return this.docs.remove(owner, name, docId, actor(u), ip);
  }
}

@Controller('fleet/companies/:id/documents')
export class CompanyDocumentsController extends OwnDocuments {
  protected readonly target = 'company' as const;
  constructor(docs: VerificationService) { super(docs); }
}

@Controller('businesses/:id/documents')
export class BusinessDocumentsController extends OwnDocuments {
  protected readonly target = 'business' as const;
  constructor(docs: VerificationService) { super(docs); }
}

/** Batoma's staff, verifying: a company's or a business's documents, each look audited. */
@Controller('admin/verification-documents')
@Roles(Role.ADMIN, Role.MODERATOR)
export class AdminDocumentsController {
  constructor(private docs: VerificationService) {}

  @Get()
  list(@Query('operatorId') operatorId?: string, @Query('businessId') businessId?: string) {
    return this.docs.adminList({ operatorId, businessId });
  }

  @Get(':docId/link')
  link(@Param('docId', ParseUUIDPipe) docId: string, @CurrentUser() u: AuthUser, @Ip() ip: string) {
    return this.docs.adminLink(docId, actor(u), ip);
  }
}
