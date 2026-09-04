import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleEntity } from '../../../../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { HubEntity } from '../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Injectable()
export class VehicleSeedService {
  constructor(
    @InjectRepository(VehicleEntity)
    private readonly repository: Repository<VehicleEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
  ) {}

  async run() {
    // Get all hubs for mapping
    const hubs = await this.hubRepository.find();
    const findHubId = (hubCode: string) => {
      const found = hubs.find((h) => h.code === hubCode);
      return found ? found.id : null;
    };

    const hcmHubId = findHubId('HUB-HCM-01');
    const dadHubId = findHubId('HUB-DAD-01');
    const hynHubId = findHubId('HUB-HYN-01');
    const boHcmHubId = findHubId('HUB-BO-HCM-01');
    const boDadHubId = findHubId('HUB-BO-DAD-01');
    const boHynHubId = findHubId('HUB-BO-HYN-01');

    const seedVehicles = [
      {
        licensePlate: '75H-051.21',
        model: 'Volvo FH16 Globetrotter',
        type: 'CONTAINER_40FT',
        maxWeight: 32000,
        maxVolume: 76.5,
        currentHub: 'Andromeda Hub - HCM',
        hubId: hcmHubId,
        status: 'AVAILABLE',
      },
      {
        licensePlate: '43H-212.48',
        model: 'Hino 500 Series FL8JT7A',
        type: 'TRUCK_8T',
        maxWeight: 8000,
        maxVolume: 42.0,
        currentHub: 'Magellan Hub - Đà Nẵng',
        hubId: dadHubId,
        status: 'IN_USE',
      },
      {
        licensePlate: '29C-888.66',
        model: 'Hyundai Mighty 110S',
        type: 'TRUCK_5T',
        maxWeight: 5000,
        maxVolume: 28.5,
        currentHub: 'Polaris Hub - Hưng Yên',
        hubId: hynHubId,
        status: 'AVAILABLE',
      },
      {
        licensePlate: '51D-991.02',
        model: 'Isuzu FVR34Q 9 Tấn',
        type: 'CONTAINER_20FT',
        maxWeight: 15000,
        maxVolume: 38.0,
        currentHub: 'Xe bo HCM',
        hubId: boHcmHubId,
        status: 'AVAILABLE',
      },
      {
        licensePlate: '43C-333.11',
        model: 'Thaco Towner 800',
        type: 'TRUCK_5T',
        maxWeight: 3500,
        maxVolume: 18.0,
        currentHub: 'Xe bo Đà Nẵng',
        hubId: boDadHubId,
        status: 'AVAILABLE',
      },
      {
        licensePlate: '89C-555.22',
        model: 'Suzuki Carry Pro',
        type: 'TRUCK_5T',
        maxWeight: 2500,
        maxVolume: 14.0,
        currentHub: 'Xe bo Hưng Yên',
        hubId: boHynHubId,
        status: 'AVAILABLE',
      },
    ];

    for (const v of seedVehicles) {
      const existing = await this.repository.findOne({
        where: { licensePlate: v.licensePlate },
      });

      if (!existing) {
        await this.repository.save(this.repository.create(v));
      } else {
        existing.hubId = v.hubId;
        existing.currentHub = v.currentHub;
        existing.model = v.model;
        existing.type = v.type;
        existing.maxWeight = v.maxWeight;
        existing.maxVolume = v.maxVolume;
        await this.repository.save(existing);
      }
    }
  }
}
