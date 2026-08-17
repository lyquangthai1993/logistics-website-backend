import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DriverEntity } from '../../../../drivers/infrastructure/persistence/relational/entities/driver.entity';

@Injectable()
export class DriverSeedService {
  constructor(
    @InjectRepository(DriverEntity)
    private readonly repository: Repository<DriverEntity>,
  ) {}

  async run() {
    const seedDrivers = [
      {
        fullName: 'Nguyễn Văn Tài',
        phone: '0905123456',
        licenseNumber: '790123456789',
        licenseClass: 'FC',
        experienceYears: 8,
        status: 'AVAILABLE',
      },
      {
        fullName: 'Phạm Đức Lái',
        phone: '0912987654',
        licenseNumber: '480987654321',
        licenseClass: 'C',
        experienceYears: 5,
        status: 'ON_TRIP',
      },
      {
        fullName: 'Lê Hoàng Việt',
        phone: '0988112233',
        licenseNumber: '310456789012',
        licenseClass: 'FC',
        experienceYears: 12,
        status: 'AVAILABLE',
      },
      {
        fullName: 'Trần Văn Hùng',
        phone: '0977445566',
        licenseNumber: '920654321098',
        licenseClass: 'E',
        experienceYears: 6,
        status: 'OFF_DUTY',
      },
    ];

    for (const d of seedDrivers) {
      const count = await this.repository.count({
        where: { phone: d.phone },
      });

      if (!count) {
        await this.repository.save(this.repository.create(d));
      }
    }
  }
}
