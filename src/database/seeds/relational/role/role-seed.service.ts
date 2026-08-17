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
    const roles = [
      { id: RoleEnum.SUPER_ADMIN, name: 'Super Admin' },
      { id: RoleEnum.DISPATCHER, name: 'Dispatcher' },
      { id: RoleEnum.FLEET_MANAGER, name: 'Fleet Manager' },
      { id: RoleEnum.WAREHOUSE_MANAGER, name: 'Warehouse Manager' },
    ];

    for (const roleData of roles) {
      const count = await this.repository.count({
        where: {
          id: roleData.id,
        },
      });

      if (!count) {
        await this.repository.save(
          this.repository.create({
            id: roleData.id,
            name: roleData.name,
          }),
        );
      }
    }
  }
}
