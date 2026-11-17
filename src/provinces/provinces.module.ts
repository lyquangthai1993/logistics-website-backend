import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvinceReferenceController } from './province-reference.controller';
import { ProvinceReferenceService } from './province-reference.service';
import { ProvinceReferenceEntity } from './infrastructure/persistence/relational/entities/province-reference.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ProvinceReferenceEntity])],
  controllers: [ProvinceReferenceController],
  providers: [ProvinceReferenceService],
  exports: [ProvinceReferenceService],
})
export class ProvincesModule {}
