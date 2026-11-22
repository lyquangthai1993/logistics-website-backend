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

  async getRegionLookup(): Promise<Map<string, string>> {
    const references = await this.repository.find();
    const lookup = new Map<string, string>();

    for (const reference of references) {
      const keys = [
        reference.name,
        reference.normalizedName,
        ...reference.aliases,
      ];
      for (const key of keys) {
        const normalizedKey = this.normalizeLookupKey(key);
        if (normalizedKey) lookup.set(normalizedKey, reference.region);
      }
    }

    return lookup;
  }

  resolveRegion(
    value: string | null | undefined,
    lookup: Map<string, string>,
  ): string | undefined {
    const normalizedValue = this.normalizeLookupKey(value || '');
    if (!normalizedValue) return undefined;

    const exactRegion = lookup.get(normalizedValue);
    if (exactRegion) return exactRegion;

    return [...lookup.entries()]
      .filter(([key]) => key.length >= 3)
      .sort(([left], [right]) => right.length - left.length)
      .find(([key]) => normalizedValue.includes(key))?.[1];
  }

  private normalizeLookupKey(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/^(tinh|tp\.?|thanh pho)\s+/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
