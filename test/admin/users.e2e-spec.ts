import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../utils/constants';
import { RoleEnum } from '../../src/roles/roles.enum';
import { StatusEnum } from '../../src/statuses/statuses.enum';
import validationOptions from '../../src/utils/validation-options';

describe('Users Module E2E', () => {
  let app: INestApplication;
  let apiToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.enableVersioning({
      type: VersioningType.URI,
    });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();

    // Login as Admin to obtain Bearer token
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    apiToken = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Create User by Admin', () => {
    const uniqueSuffix = Date.now();
    const newUserEmail = `user.admin.${uniqueSuffix}@example.com`;
    const newUserPassword = `secret123`;
    let createdUserId: number | string;

    it('should fail to create new user with invalid email: /api/v1/users (POST)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users')
        .auth(apiToken, { type: 'bearer' })
        .send({ email: 'invalid-email-format' })
        .expect(422);
    });

    it('should successfully create new user: /api/v1/users (POST)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .auth(apiToken, { type: 'bearer' })
        .send({
          email: newUserEmail,
          password: newUserPassword,
          firstName: `First${uniqueSuffix}`,
          lastName: 'E2E',
          role: { id: RoleEnum.DISPATCHER },
          status: { id: StatusEnum.active },
        })
        .expect(201);

      createdUserId = res.body.id;
      expect(createdUserId).toBeDefined();
      expect(res.body.email).toBe(newUserEmail);
    });

    it('should successfully login as the newly created user: /api/v1/auth/email/login (POST)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: newUserEmail,
          password: newUserPassword,
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe(newUserEmail);
    });
  });

  describe('Get Many Users', () => {
    it('should get paginated list of users: /api/v1/users (GET)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .auth(apiToken, { type: 'bearer' })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].email).toBeDefined();
      expect(res.body.data[0].password).toBeUndefined();
    });
  });
});
