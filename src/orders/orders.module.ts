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
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      OrderCodeCounterEntity,
      UserEntity,
      HubEntity,
      TripEntity,
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [OrdersController, WarehouseController],
  providers: [OrdersService, OrderCodeService, WarehouseService],
  exports: [OrdersService, OrderCodeService, WarehouseService, TypeOrmModule],
})
export class OrdersModule {}
