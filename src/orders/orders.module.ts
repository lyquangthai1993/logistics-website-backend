import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { OrderCodeCounterEntity } from './infrastructure/persistence/relational/entities/order-code-counter.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { OrdersService } from './orders.service';
import { OrderCodeService } from './order-code.service';
import { OrdersController } from './orders.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

import { TripEntity } from '../trips/infrastructure/persistence/relational/entities/trip.entity';
import { TripStopEntity } from '../trips/infrastructure/persistence/relational/entities/trip-stop.entity';
import { OrderInventoryTransactionEntity } from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { OrderActivityLogEntity } from './infrastructure/persistence/relational/entities/order-activity-log.entity';
import { DailyHubOperationalReportEntity } from './infrastructure/persistence/relational/entities/daily-hub-operational-report.entity';
import { DailyRegionalDispatchReportEntity } from './infrastructure/persistence/relational/entities/daily-regional-dispatch-report.entity';
import { CronJobConfigEntity } from './infrastructure/persistence/relational/entities/cron-job-config.entity';
import { CronJobExecutionLogEntity } from './infrastructure/persistence/relational/entities/cron-job-execution-log.entity';
import { OrderActivityLogService } from './order-activity-log.service';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { OperationalLedgerService } from './operational-ledger.service';
import { AdminReportsController } from './admin-reports.controller';
import { AdminReportsService } from './admin-reports.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderCodeCounterEntity,
      UserEntity,
      HubEntity,
      TripEntity,
      TripStopEntity,
      OrderInventoryTransactionEntity,
      OrderActivityLogEntity,
      DailyHubOperationalReportEntity,
      DailyRegionalDispatchReportEntity,
      CronJobConfigEntity,
      CronJobExecutionLogEntity,
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [OrdersController, WarehouseController, AdminReportsController],
  providers: [
    OrdersService,
    OrderCodeService,
    WarehouseService,
    OperationalLedgerService,
    OrderActivityLogService,
    AdminReportsService,
  ],
  exports: [
    OrdersService,
    OrderCodeService,
    WarehouseService,
    OperationalLedgerService,
    OrderActivityLogService,
    AdminReportsService,
    TypeOrmModule,
  ],
})
export class OrdersModule {}
