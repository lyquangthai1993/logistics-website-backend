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
import validationOptions from '../../src/utils/validation-options';

describe('Hubs Module E2E (Create Random Hub)', () => {
  let app: INestApplication;
  let adminToken: string;

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

    // Login as Admin (Super Admin) to obtain Bearer token
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/email/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);

    adminToken = res.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Random Hub Lifecycle Flow', () => {
    const randomSuffix = Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();
    const cities = [
      'Hải Phòng',
      'Đà Nẵng',
      'Cần Thơ',
      'Bình Dương',
      'Đồng Nai',
      'Nha Trang',
    ];
    const randomCity = cities[Math.floor(Math.random() * cities.length)];
    const randomPhone = `09${Math.floor(10000000 + Math.random() * 90000000)}`;

    const randomHubDto = {
      code: `HUB-RND-${randomSuffix}`,
      name: `Kho Vận Tự Động ${randomCity} #${randomSuffix}`,
      city: randomCity,
      address: `Số ${Math.floor(Math.random() * 500) + 1} Đường Hậu Cần, ${randomCity}`,
      contactPhone: randomPhone,
      managerName: `Trưởng kho ${randomSuffix}`,
      isActive: true,
    };

    let createdHubId: number;

    it('should fail with 422 if required fields are missing: /api/v1/hubs (POST)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/hubs')
        .auth(adminToken, { type: 'bearer' })
        .send({ name: 'Incomplete Hub' })
        .expect(422);
    });

    it('should successfully create a new random hub in DB: /api/v1/hubs (POST)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/hubs')
        .auth(adminToken, { type: 'bearer' })
        .send(randomHubDto)
        .expect(201);

      expect(res.body).toBeDefined();
      expect(res.body.id).toBeDefined();
      expect(res.body.code).toBe(randomHubDto.code);
      expect(res.body.name).toBe(randomHubDto.name);
      expect(res.body.city).toBe(randomHubDto.city);
      expect(res.body.isActive).toBe(true);

      createdHubId = res.body.id;
    });

    it('should throw 409 Conflict when creating a hub with duplicate code: /api/v1/hubs (POST)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/hubs')
        .auth(adminToken, { type: 'bearer' })
        .send(randomHubDto)
        .expect(409);
    });

    it('should retrieve the newly created hub by ID from DB: /api/v1/hubs/:id (GET)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/hubs/${createdHubId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(res.body.id).toBe(createdHubId);
      expect(res.body.code).toBe(randomHubDto.code);
      expect(res.body.name).toBe(randomHubDto.name);
    });

    it('should find the newly created hub in active list: /api/v1/hubs/active (GET)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/hubs/active')
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const found = res.body.find(
        (h: { id: number; code: string }) => h.id === createdHubId,
      );
      expect(found).toBeDefined();
      expect(found.code).toBe(randomHubDto.code);
    });

    it('should soft delete the created hub and clean up: /api/v1/hubs/:id (DELETE)', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/hubs/${createdHubId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(200);

      // Verify hub is no longer retrievable
      await request(app.getHttpServer())
        .get(`/api/v1/hubs/${createdHubId}`)
        .auth(adminToken, { type: 'bearer' })
        .expect(404);
    });
  });
});
