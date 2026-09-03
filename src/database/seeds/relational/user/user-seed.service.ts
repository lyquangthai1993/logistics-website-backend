import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserEntity } from '../../../../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../../../../hubs/infrastructure/persistence/relational/entities/hub.entity';

@Injectable()
export class UserSeedService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
  ) {}

  async run() {
    const seedUsers = [
      {
        username: 'admin',
        firstName: 'Super',
        lastName: 'Admin',
        email: 'lyquangthai1993+1@gmail.com',
        legacyEmails: [
          'admin@spiderexpress.vn',
          'lyquangthai1993+admin@gmail.com',
        ],
        roleId: RoleEnum.SUPER_ADMIN,
        roleName: 'Super Admin',
        hubCode: null,
      },
      {
        username: 'dispatcher',
        firstName: 'Đức',
        lastName: 'Anh',
        email: 'lyquangthai1993+2@gmail.com',
        legacyEmails: [
          'ducanh@spiderexpress.vn',
          'lyquangthai1993+dispatcher@gmail.com',
        ],
        roleId: RoleEnum.DISPATCHER,
        roleName: 'Dispatcher',
        hubCode: 'HUB-HAN-01',
      },
      {
        username: 'fleet',
        firstName: 'Quản lý',
        lastName: 'Đội Xe',
        email: 'lyquangthai1993+3@gmail.com',
        legacyEmails: [
          'fleet@spiderexpress.vn',
          'lyquangthai1993+fleet@gmail.com',
        ],
        roleId: RoleEnum.FLEET_MANAGER,
        roleName: 'Fleet Manager',
        hubCode: 'HUB-DAD-01',
      },
      {
        username: 'warehouse_han',
        firstName: 'Quản lý',
        lastName: 'Kho Hà Nội',
        email: 'lyquangthai1993+4@gmail.com',
        legacyUsernames: ['warehouse', 'warehouse_han'],
        legacyEmails: [
          'warehouse@spiderexpress.vn',
          'lyquangthai1993+warehouse@gmail.com',
          'warehouse_han@spiderexpress.vn',
          'lyquangthai1993+warehouse_han@gmail.com',
        ],
        roleId: RoleEnum.WAREHOUSE_MANAGER,
        roleName: 'Warehouse Manager',
        hubCode: 'HUB-HAN-01',
      },
      {
        username: 'warehouse_dad',
        firstName: 'Quản lý',
        lastName: 'Kho Đà Nẵng',
        email: 'lyquangthai1993+5@gmail.com',
        legacyUsernames: ['warehouse_dad'],
        legacyEmails: [
          'warehouse_dad@spiderexpress.vn',
          'lyquangthai1993+warehouse_dad@gmail.com',
        ],
        roleId: RoleEnum.WAREHOUSE_MANAGER,
        roleName: 'Warehouse Manager',
        hubCode: 'HUB-DAD-01',
      },
      {
        username: 'warehouse_sgn',
        firstName: 'Quản lý',
        lastName: 'Kho Sài Gòn',
        email: 'lyquangthai1993+6@gmail.com',
        legacyUsernames: ['warehouse_sgn'],
        legacyEmails: [
          'warehouse_sgn@spiderexpress.vn',
          'lyquangthai1993+warehouse_sgn@gmail.com',
        ],
        roleId: RoleEnum.WAREHOUSE_MANAGER,
        roleName: 'Warehouse Manager',
        hubCode: 'HUB-SGN-01',
      },
    ];

    const salt = await bcrypt.genSalt();
    const password = await bcrypt.hash('secret', salt);

    for (const u of seedUsers) {
      const hub = u.hubCode
        ? await this.hubRepository.findOne({ where: { code: u.hubCode } })
        : null;

      if (u.hubCode && !hub) {
        throw new Error(`Seed hub not found: ${u.hubCode}`);
      }

      // Find existing user by username, legacy usernames, new email, or legacy emails
      const searchConditions: Array<{ username?: string; email?: string }> = [
        { username: u.username },
        ...((u as any).legacyUsernames || []).map((lu: string) => ({
          username: lu,
        })),
        { email: u.email },
        ...u.legacyEmails.map((legacy) => ({ email: legacy })),
      ];

      const user = await this.repository.findOne({
        where: searchConditions,
      });

      if (user) {
        user.username = u.username;
        user.email = u.email;
        user.firstName = u.firstName;
        user.lastName = u.lastName;
        user.password = password;
        user.role = {
          id: u.roleId,
          name: u.roleName,
        } as any;
        user.status = {
          id: StatusEnum.active,
          name: 'Active',
        } as any;
        user.hubId = hub?.id ?? null;
        await this.repository.save(user);
      } else {
        await this.repository.save(
          this.repository.create({
            username: u.username,
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
            hubId: hub?.id ?? null,
          }),
        );
      }
    }
  }
}
