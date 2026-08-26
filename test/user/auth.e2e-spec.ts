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

describe('User Auth Module E2E', () => {
  let app: INestApplication;
  let userToken: string;
  let userRefreshToken: string;
  let userEmail: string;

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Login & Token Issuance', () => {
    it('should successfully login with valid credentials: /api/v1/auth/email/login (POST)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.tokenExpires).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBeDefined();
      expect(res.body.user.password).toBeUndefined();

      userToken = res.body.token;
      userRefreshToken = res.body.refreshToken;
      userEmail = res.body.user.email;
    });

    it('should fail to login with wrong password: /api/v1/auth/email/login (POST)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: ADMIN_EMAIL,
          password: 'wrong-password',
        })
        .expect(422);
    });

    it('should fail to login with non-existent user: /api/v1/auth/email/login (POST)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'nonexistent.user.12345@example.com',
          password: 'password123',
        })
        .expect(422);
    });
  });

  describe('User Profile & Token Refresh', () => {
    it('should retrieve own profile: /api/v1/auth/me (GET)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .auth(userToken, { type: 'bearer' })
        .expect(200);

      expect(res.body.email).toBe(userEmail);
      expect(res.body.password).toBeUndefined();
    });

    it('should issue new access token via refresh token: /api/v1/auth/refresh (POST)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .auth(userRefreshToken, { type: 'bearer' })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      expect(res.body.tokenExpires).toBeDefined();

      // Update active token
      userToken = res.body.token;
      userRefreshToken = res.body.refreshToken;
    });

    it('should update profile firstName/lastName: /api/v1/auth/me (PATCH)', async () => {
      const updatedFirstName = `Admin`;
      const res = await request(app.getHttpServer())
        .patch('/api/v1/auth/me')
        .auth(userToken, { type: 'bearer' })
        .send({
          firstName: updatedFirstName,
        })
        .expect(200);

      expect(res.body.firstName).toBe(updatedFirstName);
    });
  });
});
