import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import bcrypt from 'bcryptjs';
import { Model } from 'mongoose';
import { RoleEnum } from '../../../../roles/roles.enum';
import { StatusEnum } from '../../../../statuses/statuses.enum';
import { UserSchemaClass } from '../../../../users/infrastructure/persistence/document/entities/user.schema';

@Injectable()
export class UserSeedService {
  constructor(
    @InjectModel(UserSchemaClass.name)
    private readonly model: Model<UserSchemaClass>,
  ) {}

  async run() {
    const admin = await this.model.findOne({
      email: 'admin@spiderexpress.vn',
    });

    if (!admin) {
      const salt = await bcrypt.genSalt();
      const password = await bcrypt.hash('secret', salt);

      const data = new this.model({
        email: 'admin@spiderexpress.vn',
        password: password,
        firstName: 'Super',
        lastName: 'Admin',
        role: {
          _id: RoleEnum.SUPER_ADMIN.toString(),
        },
        status: {
          _id: StatusEnum.active.toString(),
        },
      });
      await data.save();
    }

    const user = await this.model.findOne({
      email: 'ducanh@spiderexpress.vn',
    });

    if (!user) {
      const salt = await bcrypt.genSalt();
      const password = await bcrypt.hash('secret', salt);

      const data = new this.model({
        email: 'ducanh@spiderexpress.vn',
        password: password,
        firstName: 'Đức',
        lastName: 'Anh',
        role: {
          _id: RoleEnum.DISPATCHER.toString(),
        },
        status: {
          _id: StatusEnum.active.toString(),
        },
      });

      await data.save();
    }
  }
}
