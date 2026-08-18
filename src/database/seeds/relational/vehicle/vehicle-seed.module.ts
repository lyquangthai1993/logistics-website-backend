import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VehicleSeedService } from './vehicle-seed.service';
import { VehicleEntity } from '../../../../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { HubEntity } from '../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Module({
  imports: [TypeOrmModule.forFeature([VehicleEntity, HubEntity])],
  providers: [VehicleSeedService],
  exports: [VehicleSeedService],
})
export class VehicleSeedModule {}
