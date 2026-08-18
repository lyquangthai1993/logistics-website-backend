import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HubEntity } from '../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { HubSeedService } from './hub-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([HubEntity])],
  providers: [HubSeedService],
  exports: [HubSeedService],
})
export class HubSeedModule {}
