import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, UserEntity, HubEntity]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService, TypeOrmModule],
})
export class OrdersModule {}
