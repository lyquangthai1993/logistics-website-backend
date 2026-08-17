import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverEntity } from './infrastructure/persistence/relational/entities/driver.entity';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';

@Injectable()
export class DriversService {
  constructor(
    @InjectRepository(DriverEntity)
    private readonly driverRepository: Repository<DriverEntity>,
  ) {}

  async create(createDriverDto: CreateDriverDto): Promise<DriverEntity> {
    const driver = this.driverRepository.create(createDriverDto);
    return this.driverRepository.save(driver);
  }

  async findAll(): Promise<DriverEntity[]> {
    return this.driverRepository.find({
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<DriverEntity> {
    const driver = await this.driverRepository.findOne({ where: { id } });
    if (!driver) {
      throw new NotFoundException(`Driver with ID ${id} not found`);
    }
    return driver;
  }

  async update(
    id: number,
    updateDriverDto: UpdateDriverDto,
  ): Promise<DriverEntity> {
    const driver = await this.findOne(id);
    Object.assign(driver, updateDriverDto);
    return this.driverRepository.save(driver);
  }

  async remove(id: number): Promise<void> {
    const driver = await this.findOne(id);
    await this.driverRepository.softRemove(driver);
  }
}
