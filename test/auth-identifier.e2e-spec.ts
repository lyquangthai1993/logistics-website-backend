import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Auth Identifier (Email or Username) E2E Test', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.enableVersioning({
      type: VersioningType.URI,
    });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Login with Username', () => {
    it('should successfully login as Super Admin using username "admin"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'admin',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('admin');
      expect(res.body.user.role.id).toBe(1);
    });

    it('should successfully login as Dispatcher using username "dispatcher"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'dispatcher',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('dispatcher');
      expect(res.body.user.role.id).toBe(2);
    });

    it('should successfully login as Fleet Manager using username "fleet"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'fleet',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('fleet');
      expect(res.body.user.role.id).toBe(3);
    });

    it('should successfully login as Warehouse Manager using username "warehouse"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'warehouse',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.username).toBe('warehouse');
      expect(res.body.user.role.id).toBe(4);
    });
  });

  describe('Login with Email', () => {
    it('should successfully login as Super Admin using email "lyquangthai1993+1@gmail.com"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'lyquangthai1993+1@gmail.com',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('lyquangthai1993+1@gmail.com');
      expect(res.body.user.role.id).toBe(1);
    });

    it('should successfully login as Dispatcher using email "lyquangthai1993+2@gmail.com"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'lyquangthai1993+2@gmail.com',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('lyquangthai1993+2@gmail.com');
      expect(res.body.user.role.id).toBe(2);
    });

    it('should successfully login as Fleet Manager using email "lyquangthai1993+3@gmail.com"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'lyquangthai1993+3@gmail.com',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('lyquangthai1993+3@gmail.com');
      expect(res.body.user.role.id).toBe(3);
    });

    it('should successfully login as Warehouse Manager using email "lyquangthai1993+4@gmail.com"', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'lyquangthai1993+4@gmail.com',
          password: 'secret',
        })
        .expect(200);

      expect(res.body.token).toBeDefined();
      expect(res.body.user.email).toBe('lyquangthai1993+4@gmail.com');
      expect(res.body.user.role.id).toBe(4);
    });
  });

  describe('Invalid Scenarios', () => {
    it('should fail with 422 when user does not exist', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'nonexistent_user',
          password: 'secret',
        })
        .expect(422);
    });

    it('should fail with 422 when password is incorrect', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/email/login')
        .send({
          email: 'admin',
          password: 'wrongpassword',
        })
        .expect(422);
    });
  });
});
