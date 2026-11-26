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
import { WarehouseService } from '../../src/orders/warehouse.service';
import validationOptions from '../../src/utils/validation-options';

type Snapshot = {
  quantity: number;
  weightKg: number;
  volumeCbm: number;
  orderCount: number;
};

const HCM_HUB_ID = 1;

function payloadData<T>(body: any): T {
  return (body?.data?.data ?? body?.data ?? body) as T;
}

function round(value: unknown, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

describe('Warehouse inventory snapshot and Super Admin transaction adjustment E2E', () => {
  let app: INestApplication;
  let adminToken: string;
  let warehouseToken: string;
  let warehouseService: WarehouseService;
  let orderId: number;
  let inboundTransactionId: number;
  let orderCode: string;

  async function login(identifier: string) {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/email/login')
      .send({ email: identifier, password: 'secret' })
      .expect(200);
    return response.body?.data?.token ?? response.body?.token;
  }

  async function readSnapshot(token: string): Promise<Snapshot> {
    const response = await request(app.getHttpServer())
      .get('/api/v1/warehouse/orders/summary')
      .query({ status: 'INBOUND' })
      .auth(token, { type: 'bearer' })
      .expect(200);
    const data = payloadData<any>(response.body);
    return {
      quantity: Number(data.quantity) || 0,
      weightKg: round(data.weightKg, 3),
      volumeCbm: round(data.volumeCbm, 3),
      orderCount: Number(data.orderCount) || 0,
    };
  }

  async function refreshSnapshot() {
    await warehouseService.refreshHubOrderSummary(HCM_HUB_ID, 'MANUAL');
  }

  async function confirmOutbound(
    quantity: number,
    weight: number,
    volume: number,
  ) {
    await request(app.getHttpServer())
      .post('/api/v1/warehouse/outbound/confirm')
      .auth(warehouseToken, { type: 'bearer' })
      .send({
        orderIds: [orderId],
        items: [
          {
            orderId,
            quantityToExport: quantity,
            weightToExport: weight,
            volumeToExport: volume,
            province: 'Hồ Chí Minh',
          },
        ],
        licensePlate: `51E-${quantity}`,
        driverName: 'Tài xế E2E snapshot',
        mode: 'CUSTOMER',
        notes: `E2E snapshot xuất ${quantity} kiện`,
      })
      .expect(200);
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api', { exclude: ['/'] });
    app.enableVersioning({ type: VersioningType.URI });
    app.useGlobalPipes(new ValidationPipe(validationOptions));
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
    );
    await app.init();

    adminToken = await login('admin');
    warehouseToken = await login('warehouse_hcm');
    warehouseService = app.get(WarehouseService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should track remaining quantity in snapshots and audit Super Admin metric adjustment', async () => {
    const before = await readSnapshot(warehouseToken);
    orderCode = `E2E-SNAPSHOT-${Date.now()}`;

    const inboundResponse = await request(app.getHttpServer())
      .post('/api/v1/warehouse/inbound/quick-create')
      .auth(warehouseToken, { type: 'bearer' })
      .send({
        orderCode,
        goodsDescription: 'E2E inventory snapshot adjustment',
        totalQuantity: 48,
        totalWeight: 480,
        totalVolume: 96,
        pickupAddress: 'Andromeda Hub - HCM',
        deliveryAddress: 'Điểm giao E2E',
        province: 'Hồ Chí Minh',
        licensePlate: '51E-048',
        driverName: 'Tài xế E2E snapshot',
        tripCode: `SD-E2E-IN-${Date.now()}`,
        initialStatus: 'INBOUND',
      })
      .expect(201);
    const created = payloadData<any>(inboundResponse.body);
    orderId = Number(created.id);
    expect(orderId).toBeGreaterThan(0);

    await refreshSnapshot();
    const afterInbound = await readSnapshot(warehouseToken);
    expect(afterInbound.quantity - before.quantity).toBe(48);
    expect(afterInbound.weightKg - before.weightKg).toBe(480);
    expect(afterInbound.volumeCbm - before.volumeCbm).toBe(96);

    const transactionsResponse = await request(app.getHttpServer())
      .get(
        `/api/v1/warehouse/orders/${encodeURIComponent(orderCode)}/transactions`,
      )
      .auth(warehouseToken, { type: 'bearer' })
      .expect(200);
    const transactions = payloadData<any[]>(transactionsResponse.body);
    const inboundTransaction = transactions.find(
      (item) => item.type === 'INBOUND',
    );
    inboundTransactionId = Number(inboundTransaction?.id);
    expect(inboundTransactionId).toBeGreaterThan(0);

    await confirmOutbound(12, 120, 24);
    await refreshSnapshot();
    const afterOutbound = await readSnapshot(warehouseToken);
    expect(afterOutbound.quantity - afterInbound.quantity).toBe(-12);
    expect(afterOutbound.weightKg - afterInbound.weightKg).toBe(-120);
    expect(afterOutbound.volumeCbm - afterInbound.volumeCbm).toBe(-24);

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouse/transactions/${inboundTransactionId}/quantity`)
      .auth(adminToken, { type: 'bearer' })
      .send({
        quantity: 60,
        weight: 600,
        volume: 120,
        reason: 'E2E Super Admin tam suất',
      })
      .expect(200);
    await refreshSnapshot();
    const afterAdjustment = await readSnapshot(warehouseToken);
    expect(afterAdjustment.quantity - before.quantity).toBe(48);
    expect(afterAdjustment.weightKg - before.weightKg).toBe(480);
    expect(afterAdjustment.volumeCbm - before.volumeCbm).toBe(96);

    await request(app.getHttpServer())
      .patch(`/api/v1/warehouse/transactions/${inboundTransactionId}/quantity`)
      .auth(warehouseToken, { type: 'bearer' })
      .send({
        quantity: 61,
        weight: 610,
        volume: 122,
        reason: 'Không được phép',
      })
      .expect(403);

    await confirmOutbound(48, 480, 96);
    await refreshSnapshot();
    const afterCleanup = await readSnapshot(warehouseToken);
    expect(afterCleanup).toEqual(before);
  });
});
