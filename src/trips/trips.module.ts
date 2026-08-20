import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TripEntity } from './infrastructure/persistence/relational/entities/trip.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { VehicleEntity } from '../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { DriverEntity } from '../drivers/infrastructure/persistence/relational/entities/driver.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { TripsService } from './trips.service';
import { TripsController } from './trips.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TripEntity,
      OrderEntity,
      VehicleEntity,
      DriverEntity,
      UserEntity,
      HubEntity,
    ]),
    NotificationsModule,
    MailModule,
  ],
  controllers: [TripsController],
  providers: [TripsService],
  exports: [TripsService, TypeOrmModule],
})
export class TripsModule {}
