import { Module } from '@nestjs/common';
import { MagazineController } from './magazine.controller';
import { MagazineService } from './magazine.service';

@Module({ controllers: [MagazineController], providers: [MagazineService] })
export class MagazineModule {}
