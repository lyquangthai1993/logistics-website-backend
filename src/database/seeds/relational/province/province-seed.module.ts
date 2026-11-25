import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvinceReferenceEntity } from '../../../../provinces/infrastructure/persistence/relational/entities/province-reference.entity';
import { ProvinceSeedService } from './province-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProvinceReferenceEntity])],
  providers: [ProvinceSeedService],
  exports: [ProvinceSeedService],
})
export class ProvinceSeedModule {}
