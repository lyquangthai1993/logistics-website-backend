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

    // ── 3 Xe Trục Chính (Linehaul Container / Tải Nặng) ──
    const mainVehicles = [
      {
        licensePlate: '75H-051.21',
        type: 'CONTAINER_40FT',
        maxWeight: 32000,
        maxVolume: 76.5,
        currentHub: 'Andromeda Hub - HCM',
        hubId: hcmHubId,
        status: 'AVAILABLE',
      },
      {
        licensePlate: '43H-212.48',
        type: 'TRUCK_8T',
        maxWeight: 8000,
        maxVolume: 42.0,
        currentHub: 'Magellan Hub - Đà Nẵng',
        hubId: dadHubId,
        status: 'IN_USE',
      },
      {
        licensePlate: '29C-888.66',
        type: 'TRUCK_5T',
        maxWeight: 5000,
        maxVolume: 28.5,
        currentHub: 'Polaris Hub - Hưng Yên',
        hubId: hynHubId,
        status: 'AVAILABLE',
      },
    ];

    // ── 34 Tuyến Xe Bo ứng với 34 Tỉnh Thành Việt Nam (Không quản lý model, chỉ quản lý biển số và thông số tải) ──
    const xeBoVehicles = [
      // 6 Thành phố trực thuộc Trung ương
      {
        licensePlate: '51D-991.02',
        code: 'HUB-BO-HCM-01',
        hubName: 'Xe bo Tuyến HCM',
        maxWeight: 15000,
        maxVolume: 38.0,
        type: 'CONTAINER_20FT',
      },
      {
        licensePlate: '29C-771.15',
        code: 'HUB-BO-HAN-01',
        hubName: 'Xe bo Tuyến Hà Nội',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '43C-333.11',
        code: 'HUB-BO-DAD-01',
        hubName: 'Xe bo Tuyến Đà Nẵng',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '15C-442.88',
        code: 'HUB-BO-HPH-01',
        hubName: 'Xe bo Tuyến Hải Phòng',
        maxWeight: 5000,
        maxVolume: 24.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '65C-225.66',
        code: 'HUB-BO-CTH-01',
        hubName: 'Xe bo Tuyến Cần Thơ',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '75C-118.99',
        code: 'HUB-BO-HUE-01',
        hubName: 'Xe bo Tuyến Huế',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },

      // 28 Tỉnh thành
      {
        licensePlate: '89C-555.22',
        code: 'HUB-BO-HYN-01',
        hubName: 'Xe bo Tuyến Hưng Yên',
        maxWeight: 2500,
        maxVolume: 14.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '99C-331.45',
        code: 'HUB-BO-BNI-01',
        hubName: 'Xe bo Tuyến Bắc Ninh',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '14C-662.18',
        code: 'HUB-BO-QNI-01',
        hubName: 'Xe bo Tuyến Quảng Ninh',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '35C-882.34',
        code: 'HUB-BO-NBI-01',
        hubName: 'Xe bo Tuyến Ninh Bình',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '20C-551.90',
        code: 'HUB-BO-TNG-01',
        hubName: 'Xe bo Tuyến Thái Nguyên',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '19C-441.23',
        code: 'HUB-BO-PTH-01',
        hubName: 'Xe bo Tuyến Phú Thọ',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '24C-772.61',
        code: 'HUB-BO-LCA-01',
        hubName: 'Xe bo Tuyến Lào Cai',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '22C-331.78',
        code: 'HUB-BO-TQU-01',
        hubName: 'Xe bo Tuyến Tuyên Quang',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '12C-552.12',
        code: 'HUB-BO-LSN-01',
        hubName: 'Xe bo Tuyến Lạng Sơn',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '11C-221.45',
        code: 'HUB-BO-CBA-01',
        hubName: 'Xe bo Tuyến Cao Bằng',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '25C-661.34',
        code: 'HUB-BO-LCH-01',
        hubName: 'Xe bo Tuyến Lai Châu',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '27C-882.56',
        code: 'HUB-BO-DBI-01',
        hubName: 'Xe bo Tuyến Điện Biên',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '26C-441.89',
        code: 'HUB-BO-SLA-01',
        hubName: 'Xe bo Tuyến Sơn La',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '36C-992.11',
        code: 'HUB-BO-THO-01',
        hubName: 'Xe bo Tuyến Thanh Hóa',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '37C-771.65',
        code: 'HUB-BO-NAN-01',
        hubName: 'Xe bo Tuyến Nghệ An',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '38C-552.33',
        code: 'HUB-BO-HTI-01',
        hubName: 'Xe bo Tuyến Hà Tĩnh',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '74C-331.88',
        code: 'HUB-BO-QTR-01',
        hubName: 'Xe bo Tuyến Quảng Trị',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '76C-662.44',
        code: 'HUB-BO-QNG-01',
        hubName: 'Xe bo Tuyến Quảng Ngãi',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '81C-881.22',
        code: 'HUB-BO-GLA-01',
        hubName: 'Xe bo Tuyến Gia Lai',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '79C-552.77',
        code: 'HUB-BO-KHO-01',
        hubName: 'Xe bo Tuyến Khánh Hòa',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '49C-441.90',
        code: 'HUB-BO-LDG-01',
        hubName: 'Xe bo Tuyến Lâm Đồng',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '47C-772.15',
        code: 'HUB-BO-DLK-01',
        hubName: 'Xe bo Tuyến Đắk Lắk',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '60C-991.33',
        code: 'HUB-BO-DNA-01',
        hubName: 'Xe bo Tuyến Đồng Nai',
        maxWeight: 5000,
        maxVolume: 25.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '70C-332.55',
        code: 'HUB-BO-TNI-01',
        hubName: 'Xe bo Tuyến Tây Ninh',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '66C-551.77',
        code: 'HUB-BO-DTH-01',
        hubName: 'Xe bo Tuyến Đồng Tháp',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '64C-882.44',
        code: 'HUB-BO-VLO-01',
        hubName: 'Xe bo Tuyến Vĩnh Long',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '67C-221.88',
        code: 'HUB-BO-AGI-01',
        hubName: 'Xe bo Tuyến An Giang',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
      {
        licensePlate: '69C-442.66',
        code: 'HUB-BO-CMA-01',
        hubName: 'Xe bo Tuyến Cà Mau',
        maxWeight: 3500,
        maxVolume: 18.0,
        type: 'TRUCK_5T',
      },
    ].map((xb) => ({
      licensePlate: xb.licensePlate,
      type: xb.type,
      maxWeight: xb.maxWeight,
      maxVolume: xb.maxVolume,
      currentHub: xb.hubName,
      hubId: findHubId(xb.code),
      status: 'AVAILABLE',
    }));

    const seedVehicles = [...mainVehicles, ...xeBoVehicles];

    for (const v of seedVehicles) {
      const existing = await this.repository.findOne({
        where: { licensePlate: v.licensePlate },
      });

      if (!existing) {
        await this.repository.save(this.repository.create(v));
      } else {
        existing.hubId = v.hubId;
        existing.currentHub = v.currentHub;
        existing.model = null; // Không quản lý model, dọn sạch nếu từng tồn tại
        existing.type = v.type;
        existing.maxWeight = v.maxWeight;
        existing.maxVolume = v.maxVolume;
        await this.repository.save(existing);
      }
    }
  }
}
