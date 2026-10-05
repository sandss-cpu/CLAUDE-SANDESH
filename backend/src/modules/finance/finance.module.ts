import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FleetModule } from '../fleet/fleet.module';
import { FinanceAccessService } from './finance-access.service';
import { FinanceController } from './finance.controller';
import { IncomeImportService } from './income-import.service';
import { IncomeReportsService } from './income-reports.service';
import { IncomeService } from './income.service';

@Module({
  imports: [AuthModule, FleetModule],
  controllers: [FinanceController],
  providers: [FinanceAccessService, IncomeService, IncomeImportService, IncomeReportsService],
})
export class FinanceModule {}
