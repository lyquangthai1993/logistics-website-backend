import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HubEntity } from '../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Injectable()
export class HubSeedService {
  constructor(
    @InjectRepository(HubEntity)
    private readonly repository: Repository<HubEntity>,
  ) {}

  async run() {
    const seedHubs = [
      {
        code: 'HUB-HAN-01',
        name: 'Andromeda Hub (Hà Nội)',
        city: 'Hà Nội',
        address: 'KCN Bắc Thăng Long, Huyện Đông Anh, TP. Hà Nội',
        contactPhone: '024-3886-1234',
        managerName: 'Nguyễn Văn Quản',
        isActive: true,
      },
      {
        code: 'HUB-DAD-01',
        name: 'Magellan Hub (Đà Nẵng)',
        city: 'Đà Nẵng',
        address: 'KCN Hòa Khánh, Quận Liên Chiểu, TP. Đà Nẵng',
        contactPhone: '0236-3732-555',
        managerName: 'Trần Đình Kho',
        isActive: true,
      },
      {
        code: 'HUB-SGN-01',
        name: 'Centaurus Hub (TP.HCM)',
        city: 'TP. Hồ Chí Minh',
        address: 'Khu Công Nghệ Cao, TP. Thủ Đức, TP. Hồ Chí Minh',
        contactPhone: '028-3736-8888',
        managerName: 'Lê Hoàng Nam',
        isActive: true,
      },
      {
        code: 'HUB-VTH-01',
        name: 'Pegasus Hub (Cần Thơ)',
        city: 'Cần Thơ',
        address: 'KCN Trà Nóc 1, Quận Bình Thủy, TP. Cần Thơ',
        contactPhone: '0292-3841-222',
        managerName: 'Phạm Minh Đức',
        isActive: true,
      },
      {
        code: 'HUB-HPH-01',
        name: 'Vela Hub (Hải Phòng)',
        city: 'Hải Phòng',
        address: 'KCN Đình Vũ, Quận Hải An, TP. Hải Phòng',
        contactPhone: '0225-3979-666',
        managerName: 'Hoàng Hải Cảng',
        isActive: true,
      },
    ];

    for (const h of seedHubs) {
      const count = await this.repository.count({
        where: { code: h.code },
      });

      if (!count) {
        await this.repository.save(this.repository.create(h));
      }
    }
  }
}
