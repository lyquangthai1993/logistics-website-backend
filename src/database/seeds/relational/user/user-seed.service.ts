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
      },
      {
        username: 'warehouse',
        firstName: 'Quản lý',
        lastName: 'Kho',
        email: 'lyquangthai1993+4@gmail.com',
        legacyEmails: [
          'warehouse@spiderexpress.vn',
          'lyquangthai1993+warehouse@gmail.com',
        ],
        roleId: RoleEnum.WAREHOUSE_MANAGER,
        roleName: 'Warehouse Manager',
      },
    ];

    const salt = await bcrypt.genSalt();
    const password = await bcrypt.hash('secret', salt);

    for (const u of seedUsers) {
      // Find existing user by username, new email, or legacy emails
      const searchConditions: Array<{ username?: string; email?: string }> = [
        { username: u.username },
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
          }),
        );
      }
    }
  }
}
