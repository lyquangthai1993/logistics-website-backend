import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserSeedService } from './user-seed.service';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, HubEntity])],
  providers: [UserSeedService],
  exports: [UserSeedService],
})
export class UserSeedModule {}
