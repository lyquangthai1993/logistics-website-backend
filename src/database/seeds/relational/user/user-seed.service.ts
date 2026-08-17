import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';

@Injectable()
export class UserSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async run() {
    const seedUsers = [
      {
        firstName: 'Super',
        lastName: 'Admin',
        email: 'admin@spiderexpress.vn',
        roleId: RoleEnum.SUPER_ADMIN,
        roleName: 'Super Admin',
      },
      {
        firstName: 'Đức',
        lastName: 'Anh',
        email: 'ducanh@spiderexpress.vn',
        roleId: RoleEnum.DISPATCHER,
        roleName: 'Dispatcher',
      },
      {
        firstName: 'Quản lý',
        lastName: 'Đội Xe',
        email: 'fleet@spiderexpress.vn',
        roleId: RoleEnum.FLEET_MANAGER,
        roleName: 'Fleet Manager',
      },
      {
        firstName: 'Quản lý',
        lastName: 'Kho',
        email: 'warehouse@spiderexpress.vn',
        roleId: RoleEnum.WAREHOUSE_MANAGER,
        roleName: 'Warehouse Manager',
      },
    ];

    const salt = await bcrypt.genSalt();
    const password = await bcrypt.hash('secret', salt);

    for (const u of seedUsers) {
      const count = await this.repository.count({
        where: {
          email: u.email,
        },
      });

      if (!count) {
        await this.repository.save(
          this.repository.create({
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email,
            password,
            role: {
              id: u.roleId,
              name: u.roleName,
            },
            status: {
              id: StatusEnum.active,
              name: 'Active',
            },
          }),
        );
      }
    }
  }
}
