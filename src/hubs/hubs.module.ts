import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HubEntity } from './infrastructure/persistence/relational/entities/hub.entity';
import { VehicleEntity } from '../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { HubsService } from './hubs.service';
import { HubsController } from './hubs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([HubEntity, VehicleEntity])],
  controllers: [HubsController],
  providers: [HubsService],
  exports: [HubsService, TypeOrmModule],
})
export class HubsModule {}
