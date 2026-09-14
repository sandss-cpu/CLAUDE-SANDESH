import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { SafetyService } from './safety.service';
import { EmergencyContactDto, SosDto } from './dto/safety.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('safety')
export class SafetyController {
  constructor(private safety: SafetyService) {}

  /** Public and cacheable — must work with no account and no signal. */
  @Public() @Get('directory')
  directory(@Query('district') district?: string) {
    return this.safety.directory(district);
  }

  @Get('contacts')
  contacts(@CurrentUser('id') userId: string) { return this.safety.contacts(userId); }

  @Post('contacts')
  addContact(@CurrentUser('id') userId: string, @Body() dto: EmergencyContactDto) {
    return this.safety.addContact(userId, dto);
  }

  @Delete('contacts/:id')
  removeContact(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.safety.removeContact(userId, id);
  }

  @Post('sos')
  sos(@CurrentUser('id') userId: string, @Body() dto: SosDto) {
    return this.safety.sos(userId, dto);
  }
}
