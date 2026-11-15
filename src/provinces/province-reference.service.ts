import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProvinceReferenceEntity } from './infrastructure/persistence/relational/entities/province-reference.entity';

@Injectable()
export class ProvinceReferenceService {
  constructor(
    @InjectRepository(ProvinceReferenceEntity)
    private readonly repository: Repository<ProvinceReferenceEntity>,
  ) {}

  findAll(): Promise<ProvinceReferenceEntity[]> {
    return this.repository.find({ order: { name: 'ASC' } });
  }
}
