import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoleEntity } from '../../../../roles/infrastructure/persistence/relational/entities/role.entity';
import { RoleEnum } from '../../../../roles/roles.enum';

@Injectable()
export class RoleSeedService {
  constructor(
    @InjectRepository(RoleEntity)
    private readonly repository: Repository<RoleEntity>,
  ) {}

  async run() {
    const roles: Array<{
      id: number;
      name: string;
      displayName: string;
      description: string;
    }> = [
      {
        id: RoleEnum.SUPER_ADMIN,
        name: 'Super Admin',
        displayName: 'Quản trị viên cấp cao',
        description:
          'Có toàn quyền truy cập vào tất cả các phân hệ, cài đặt hệ thống và quản lý người dùng. Chịu trách nhiệm quản trị và vận hành toàn bộ nền tảng.',
      },
      {
        id: RoleEnum.DISPATCHER,
        name: 'Dispatcher',
        displayName: 'Điều phối viên',
        description:
          'Quản lý và phân công đơn hàng vận chuyển cho tài xế. Theo dõi trạng thái đơn hàng theo thời gian thực, điều phối tuyến đường và xử lý các sự cố phát sinh trong quá trình vận hành.',
      },
      {
        id: RoleEnum.FLEET_MANAGER,
        name: 'Fleet Manager',
        displayName: 'Quản lý đội xe',
        description:
          'Giám sát toàn bộ đội xe bao gồm lịch bảo dưỡng định kỳ, phân công tài xế và báo cáo hiệu suất hoạt động của phương tiện.',
      },
      {
        id: RoleEnum.WAREHOUSE_MANAGER,
        name: 'Warehouse Manager',
        displayName: 'Quản lý kho',
        description:
          'Điều hành hoạt động kho bãi bao gồm quản lý hàng tồn kho, xử lý hàng hóa nhập/xuất kho và tối ưu hóa không gian lưu trữ.',
      },
    ];

    for (const roleData of roles) {
      const existing = await this.repository.findOne({
        where: { id: roleData.id },
      });

      if (!existing) {
        await this.repository.save(this.repository.create(roleData));
      } else {
        await this.repository.save({
          ...existing,
          name: roleData.name,
          displayName: roleData.displayName,
          description: roleData.description,
        });
      }
    }
  }
}
