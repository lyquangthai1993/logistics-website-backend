import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PROVINCE_DEFINITIONS,
  removeVietnameseAccents,
} from '../../../../orders/utils/region-normalizer.util';
import { ProvinceReferenceEntity } from '../../../../provinces/infrastructure/persistence/relational/entities/province-reference.entity';

@Injectable()
export class ProvinceSeedService {
  constructor(
    @InjectRepository(ProvinceReferenceEntity)
    private readonly repository: Repository<ProvinceReferenceEntity>,
  ) {}

  async run(): Promise<void> {
    await this.repository.upsert(
      PROVINCE_DEFINITIONS.map((province) => ({
        name: province.standardName,
        normalizedName: removeVietnameseAccents(province.standardName),
        region: province.region,
        aliases: province.aliases,
      })),
      ['normalizedName'],
    );
  }
}
