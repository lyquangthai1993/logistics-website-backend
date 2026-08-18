import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleEntity } from './infrastructure/persistence/relational/entities/vehicle.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(VehicleEntity)
    private readonly vehicleRepository: Repository<VehicleEntity>,
  ) {}

  async create(createVehicleDto: CreateVehicleDto): Promise<VehicleEntity> {
    const existing = await this.vehicleRepository.findOne({
      where: { licensePlate: createVehicleDto.licensePlate },
    });
    if (existing) {
      throw new ConflictException(
        `Vehicle with license plate ${createVehicleDto.licensePlate} already exists`,
      );
    }

    const vehicle = this.vehicleRepository.create(createVehicleDto);
    return this.vehicleRepository.save(vehicle);
  }

  async findAll(): Promise<VehicleEntity[]> {
    return this.vehicleRepository.find({
      relations: ['hub'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<VehicleEntity> {
    const vehicle = await this.vehicleRepository.findOne({
      where: { id },
      relations: ['hub'],
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }
    return vehicle;
  }

  async update(
    id: number,
    updateVehicleDto: UpdateVehicleDto,
  ): Promise<VehicleEntity> {
    const vehicle = await this.findOne(id);

    if (
      updateVehicleDto.licensePlate &&
      updateVehicleDto.licensePlate !== vehicle.licensePlate
    ) {
      const existing = await this.vehicleRepository.findOne({
        where: { licensePlate: updateVehicleDto.licensePlate },
      });
      if (existing) {
        throw new ConflictException(
          `Vehicle with license plate ${updateVehicleDto.licensePlate} already exists`,
        );
      }
    }

    Object.assign(vehicle, updateVehicleDto);
    return this.vehicleRepository.save(vehicle);
  }

  async remove(id: number): Promise<void> {
    const vehicle = await this.findOne(id);
    await this.vehicleRepository.softRemove(vehicle);
  }
}
