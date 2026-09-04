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
      // ── Hub Cấp 1 (Main Hubs) ──
      {
        code: 'HUB-HCM-01',
        legacyCodes: ['HUB-SGN-01'],
        name: 'Andromeda Hub - HCM',
        city: 'TP. Hồ Chí Minh',
        address: 'Khu Công Nghệ Cao, TP. Thủ Đức, TP. Hồ Chí Minh',
        contactPhone: '028-3736-8888',
        managerName: 'Lê Hoàng Nam',
        isActive: true,
      },
      {
        code: 'HUB-DAD-01',
        legacyCodes: ['HUB-DAD-01'],
        name: 'Magellan Hub - Đà Nẵng',
        city: 'Đà Nẵng',
        address: 'KCN Hòa Khánh, Quận Liên Chiểu, TP. Đà Nẵng',
        contactPhone: '0236-3732-555',
        managerName: 'Trần Đình Kho',
        isActive: true,
      },
      {
        code: 'HUB-HYN-01',
        legacyCodes: ['HUB-HAN-01'],
        name: 'Polaris Hub - Hưng Yên',
        city: 'Hưng Yên',
        address: 'KCN Thăng Long II, Huyện Mỹ Hào, Tỉnh Hưng Yên',
        contactPhone: '0221-3974-888',
        managerName: 'Nguyễn Văn Quản',
        isActive: true,
      },
      // ── Hub Cấp 2 (Xe Bo / Điểm Trung Chuyển Vệ Tinh) ──
      {
        code: 'HUB-BO-HCM-01',
        legacyCodes: [],
        name: 'Xe bo HCM',
        city: 'TP. Hồ Chí Minh',
        address: 'Điểm trung chuyển phân tán TP. Hồ Chí Minh',
        contactPhone: '028-3736-9999',
        managerName: 'Tài Xế Bo HCM',
        isActive: true,
      },
      {
        code: 'HUB-BO-DAD-01',
        legacyCodes: [],
        name: 'Xe bo Đà Nẵng',
        city: 'Đà Nẵng',
        address: 'Điểm trung chuyển phân tán Đà Nẵng',
        contactPhone: '0236-3732-999',
        managerName: 'Tài Xế Bo Đà Nẵng',
        isActive: true,
      },
      {
        code: 'HUB-BO-HYN-01',
        legacyCodes: [],
        name: 'Xe bo Hưng Yên',
        city: 'Hưng Yên',
        address: 'Điểm trung chuyển phân tán Hưng Yên',
        contactPhone: '0221-3974-999',
        managerName: 'Tài Xế Bo Hưng Yên',
        isActive: true,
      },
    ];

    for (const h of seedHubs) {
      const searchConditions: Array<{ code?: string; name?: string }> = [
        { code: h.code },
        ...(h.legacyCodes || []).map((lc: string) => ({
          code: lc,
        })),
        { name: h.name },
      ];

      const existing = await this.repository.findOne({
        where: searchConditions,
      });

      if (existing) {
        existing.code = h.code;
        existing.name = h.name;
        existing.city = h.city;
        existing.address = h.address;
        existing.contactPhone = h.contactPhone;
        existing.managerName = h.managerName;
        existing.isActive = h.isActive;
        await this.repository.save(existing);
      } else {
        await this.repository.save(
          this.repository.create({
            code: h.code,
            name: h.name,
            city: h.city,
            address: h.address,
            contactPhone: h.contactPhone,
            managerName: h.managerName,
            isActive: h.isActive,
          }),
        );
      }
    }
  }
}
