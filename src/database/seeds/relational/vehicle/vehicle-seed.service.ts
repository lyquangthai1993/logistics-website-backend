import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleEntity } from '../../../../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';

@Injectable()
export class VehicleSeedService {
  constructor(
    @InjectRepository(VehicleEntity)
    private readonly repository: Repository<VehicleEntity>,
  ) {}

  async run() {
    const seedVehicles = [
      {
        licensePlate: '75H-051.21',
        model: 'Volvo FH16 Globetrotter',
        type: 'CONTAINER_40FT',
        maxWeight: 32000,
        maxVolume: 76.5,
        currentHub: 'Andromeda Hub (Hà Nội)',
        status: 'AVAILABLE',
      },
      {
        licensePlate: '43H-212.48',
        model: 'Hino 500 Series FL8JT7A',
        type: 'TRUCK_8T',
        maxWeight: 8000,
        maxVolume: 42.0,
        currentHub: 'Hubble Hub (Đà Nẵng)',
        status: 'IN_USE',
      },
      {
        licensePlate: '29C-888.66',
        model: 'Hyundai Mighty 110S',
        type: 'TRUCK_5T',
        maxWeight: 5000,
        maxVolume: 28.5,
        currentHub: 'Magellan Hub (TP.HCM)',
        status: 'AVAILABLE',
      },
      {
        licensePlate: '51D-991.02',
        model: 'Isuzu FVR34Q 9 Tấn',
        type: 'CONTAINER_20FT',
        maxWeight: 15000,
        maxVolume: 38.0,
        currentHub: 'Vela Hub (Cần Thơ)',
        status: 'MAINTENANCE',
      },
    ];

    for (const v of seedVehicles) {
      const count = await this.repository.count({
        where: { licensePlate: v.licensePlate },
      });

      if (!count) {
        await this.repository.save(this.repository.create(v));
      }
    }
  }
}
