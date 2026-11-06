import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubEntity } from './infrastructure/persistence/relational/entities/hub.entity';
import { VehicleEntity } from '../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { CreateHubDto } from './dto/create-hub.dto';
import { UpdateHubDto } from './dto/update-hub.dto';
import { QueryHubDto } from './dto/query-hub.dto';

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class HubsService {
  constructor(
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
    @InjectRepository(VehicleEntity)
    private readonly vehicleRepository: Repository<VehicleEntity>,
  ) {}

  async create(createHubDto: CreateHubDto): Promise<HubEntity> {
    const existing = await this.hubRepository.findOne({
      where: { code: createHubDto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Hub với mã "${createHubDto.code}" đã tồn tại trong hệ thống`,
      );
    }

    const hub = this.hubRepository.create(createHubDto);
    return this.hubRepository.save(hub);
  }

  async findAll(query: QueryHubDto = {}): Promise<PaginatedResult<HubEntity>> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const qb = this.hubRepository
      .createQueryBuilder('hub')
      .leftJoinAndSelect('hub.vehicles', 'vehicle');

    let resolvedIsActive = query.isActive;
    if (typeof resolvedIsActive !== 'boolean' && query.status) {
      const tokens = String(query.status)
        .toLowerCase()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const hasActive = tokens.includes('active') || tokens.includes('true');
      const hasInactive =
        tokens.includes('inactive') || tokens.includes('false');
      if (hasActive && !hasInactive) resolvedIsActive = true;
      else if (hasInactive && !hasActive) resolvedIsActive = false;
    }

    if (typeof resolvedIsActive === 'boolean') {
      qb.andWhere('hub.isActive = :isActive', { isActive: resolvedIsActive });
    }

    if (query.level && Number(query.level) > 0) {
      qb.andWhere('hub.level = :level', { level: Number(query.level) });
    }

    const rawSearch = query.search?.trim() || query.name?.trim();
    if (rawSearch) {
      const search = `%${rawSearch}%`;
      qb.andWhere(
        '(hub.code ILIKE :search OR hub.name ILIKE :search OR hub.city ILIKE :search OR hub.address ILIKE :search OR hub.managerName ILIKE :search)',
        { search },
      );
    }

    const sortFieldMap: Record<string, string> = {
      id: 'hub.id',
      code: 'hub.code',
      orderCodePrefix: 'hub.orderCodePrefix',
      name: 'hub.name',
      city: 'hub.city',
      level: 'hub.level',
      address: 'hub.address',
      manager: 'hub.managerName',
      managerName: 'hub.managerName',
      contactPhone: 'hub.contactPhone',
      status: 'hub.isActive',
      isActive: 'hub.isActive',
      createdAt: 'hub.createdAt',
      updatedAt: 'hub.updatedAt',
    };

    const appliedSorts: Array<{ column: string; order: 'ASC' | 'DESC' }> = [];
    if (query.sort && query.sort.trim()) {
      const rawSort = query.sort.trim();
      try {
        const parsed = JSON.parse(rawSort);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            const col = item?.id ? sortFieldMap[String(item.id)] : undefined;
            if (col) {
              appliedSorts.push({
                column: col,
                order: item.desc ? 'DESC' : 'ASC',
              });
            }
          }
        }
      } catch {
        // Fallback for "field:ASC|DESC" or "-field" format
        for (const part of rawSort.split(',')) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          if (trimmed.includes(':')) {
            const [field, dir] = trimmed.split(':');
            const col = sortFieldMap[field.trim()];
            if (col) {
              appliedSorts.push({
                column: col,
                order: dir?.trim().toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
              });
            }
          } else if (trimmed.startsWith('-')) {
            const col = sortFieldMap[trimmed.slice(1).trim()];
            if (col) appliedSorts.push({ column: col, order: 'DESC' });
          } else {
            const col = sortFieldMap[trimmed];
            if (col) appliedSorts.push({ column: col, order: 'ASC' });
          }
        }
      }
    }

    if (appliedSorts.length > 0) {
      appliedSorts.forEach((s, idx) => {
        if (idx === 0) {
          qb.orderBy(s.column, s.order);
        } else {
          qb.addOrderBy(s.column, s.order);
        }
      });
      qb.addOrderBy('hub.id', 'DESC');
    } else {
      qb.orderBy('hub.createdAt', 'DESC').addOrderBy('hub.id', 'DESC');
    }

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findActive(level?: number): Promise<HubEntity[]> {
    const where: any = { isActive: true };
    if (level && Number(level) > 0) {
      where.level = Number(level);
    }
    return this.hubRepository.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findOne(id: number): Promise<HubEntity> {
    const hub = await this.hubRepository.findOne({
      where: { id },
      relations: ['vehicles'],
    });
    if (!hub) {
      throw new NotFoundException(`Không tìm thấy Hub với ID ${id}`);
    }
    return hub;
  }

  async update(id: number, updateHubDto: UpdateHubDto): Promise<HubEntity> {
    const hub = await this.findOne(id);

    if (updateHubDto.code && updateHubDto.code !== hub.code) {
      const existing = await this.hubRepository.findOne({
        where: { code: updateHubDto.code },
      });
      if (existing) {
        throw new ConflictException(
          `Hub với mã "${updateHubDto.code}" đã tồn tại trong hệ thống`,
        );
      }
    }

    Object.assign(hub, updateHubDto);
    return this.hubRepository.save(hub);
  }

  async toggleActive(id: number): Promise<HubEntity> {
    const hub = await this.findOne(id);
    hub.isActive = !hub.isActive;
    return this.hubRepository.save(hub);
  }

  async softDelete(id: number): Promise<{ success: boolean; message: string }> {
    const hub = await this.findOne(id);

    const vehicleCount = await this.vehicleRepository.count({
      where: { hubId: id },
    });

    // Soft delete: set isActive to false and softRemove (sets deletedAt timestamp)
    hub.isActive = false;
    await this.hubRepository.save(hub);
    await this.hubRepository.softRemove(hub);

    let message = `Đã xóa mềm Hub "${hub.name}" (${hub.code}) thành công.`;
    if (vehicleCount > 0) {
      message += ` Lưu ý: Có ${vehicleCount} phương tiện đang trực thuộc Hub này.`;
    }

    return {
      success: true,
      message,
    };
  }
}
