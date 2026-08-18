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
      .leftJoinAndSelect('hub.vehicles', 'vehicle')
      .orderBy('hub.createdAt', 'DESC');

    if (typeof query.isActive === 'boolean') {
      qb.andWhere('hub.isActive = :isActive', { isActive: query.isActive });
    }

    if (query.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(hub.code ILIKE :search OR hub.name ILIKE :search OR hub.city ILIKE :search OR hub.address ILIKE :search OR hub.managerName ILIKE :search)',
        { search },
      );
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

  async findActive(): Promise<HubEntity[]> {
    return this.hubRepository.find({
      where: { isActive: true },
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
