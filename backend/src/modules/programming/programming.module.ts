import { Module } from '@nestjs/common';
import { ProgrammingController } from './programming.controller';
import { ProgrammingService } from './programming.service';

@Module({
  controllers: [ProgrammingController],
  providers: [ProgrammingService],
  exports: [ProgrammingService],
})
export class ProgrammingModule {}
