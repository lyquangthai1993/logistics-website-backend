import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverSeedService } from './driver-seed.service';
import { DriverEntity } from '../../../../drivers/infrastructure/persistence/relational/entities/driver.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DriverEntity])],
  providers: [DriverSeedService],
  exports: [DriverSeedService],
})
export class DriverSeedModule {}
