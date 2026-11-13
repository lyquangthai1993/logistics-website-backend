import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { WarehouseService } from './warehouse.service';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import {
  OrderInventoryTransactionEntity,
  InventoryTransactionType,
} from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { TripEntity } from '../trips/infrastructure/persistence/relational/entities/trip.entity';
import { TripStopEntity } from '../trips/infrastructure/persistence/relational/entities/trip-stop.entity';
import { OrderCodeService } from './order-code.service';
import { OperationalLedgerService } from './operational-ledger.service';
import { OrderActivityLogService } from './order-activity-log.service';
import { RedisCacheService } from '../redis/redis-cache.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { DeliveryDestinationMode } from './dto/quick-create-inbound-order.dto';
import { AppendOrderMode } from './dto/append-order-to-trip.dto';
import { RoleEnum } from '../roles/roles.enum';

/**
 * Builds an in-memory repository mock usable both as injected repository
 * and as `manager.getRepository(...)` inside `dataSource.transaction`.
 */
const makeRepo = (overrides: Record<string, any> = {}) => ({
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn().mockImplementation((data) => ({ ...data })),
  save: jest
    .fn()
    .mockImplementation((data) =>
      Promise.resolve({ id: data.id ?? 101, ...data }),
    ),
  query: jest.fn().mockResolvedValue([]),
  ...overrides,
});

describe('Orders & Warehouse — waybill code, Master Contract & operational ledger', () => {
  let ordersService: OrdersService;
  let warehouseService: WarehouseService;
  let orderRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let hubRepo: ReturnType<typeof makeRepo>;
  let tripRepo: ReturnType<typeof makeRepo>;
  let txRepo: ReturnType<typeof makeRepo>;
  let orderCodeService: { generateOrderCode: jest.Mock };
  let ledgerService: Record<string, jest.Mock>;
  let manager: { getRepository: jest.Mock; query: jest.Mock };

  const hub = {
    id: 1,
    name: 'Andromeda Hub (Hà Nội)',
    code: 'HUB-HAN-01',
    isActive: true,
  };

  const warehouseUser: any = {
    id: 1,
    email: 'warehouse@test.com',
    hubId: 1,
    hub,
    role: { id: RoleEnum.WAREHOUSE_MANAGER, name: 'WAREHOUSE_MANAGER' },
  };

  const adminUser: any = {
    id: 9,
    email: 'admin@test.com',
    hubId: null,
    role: { id: RoleEnum.SUPER_ADMIN, name: 'SUPER_ADMIN' },
  };

  const baseDto = {
    goodsDescription: 'Thùng carton linh kiện',
    totalQuantity: 20,
    totalWeight: 450,
    totalVolume: 2.5,
    deliveryMode: DeliveryDestinationMode.DIRECT_CUSTOMER,
    deliveryAddress: '123 Cầu Giấy, Hà Nội',
    licensePlate: '29C-123.45',
  };

  beforeEach(async () => {
    orderRepo = makeRepo();
    userRepo = makeRepo({
      findOne: jest.fn().mockResolvedValue(warehouseUser),
    });
    hubRepo = makeRepo({ findOne: jest.fn().mockResolvedValue(hub) });
    tripRepo = makeRepo();
    txRepo = makeRepo();

    orderCodeService = {
      generateOrderCode: jest.fn().mockResolvedValue('HAN-OP-2609-099'),
    };

    ledgerService = {
      generateTripCode: jest.fn().mockResolvedValue('SD7'),
      generateInvoiceCode: jest
        .fn()
        .mockImplementation((type: InventoryTransactionType) =>
          Promise.resolve(
            type === InventoryTransactionType.ADJUSTMENT
              ? 'DCH-SYS-2610-001'
              : 'PNK-HAN-2610-001',
          ),
        ),
      upsertTripStop: jest.fn().mockResolvedValue(undefined),
      getHubStock: jest.fn().mockResolvedValue(0),
      getInTransitQuantity: jest.fn().mockResolvedValue(0),
      getBatchPendingInboundAllocations: jest.fn().mockResolvedValue(new Map()),
      getPendingOutboundAllocation: jest.fn().mockResolvedValue({
        pendingQty: 0,
        pendingWeight: 0,
        pendingVolume: 0,
        tripCodes: [],
      }),
      getHubWeightVolumeLedger: jest.fn().mockResolvedValue({
        inboundWeight: 0,
        inboundVolume: 0,
        exportedWeight: 0,
        exportedVolume: 0,
      }),
    };

    const tripStopRepo = makeRepo();

    const repoByEntity = new Map<any, any>([
      [OrderEntity, orderRepo],
      [UserEntity, userRepo],
      [HubEntity, hubRepo],
      [TripEntity, tripRepo],
      [TripStopEntity, tripStopRepo],
      [OrderInventoryTransactionEntity, txRepo],
    ]);
    manager = {
      getRepository: jest.fn((entity: any) => repoByEntity.get(entity)),
      query: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      manager,
      getRepository: jest.fn((entity: any) => repoByEntity.get(entity)),
      transaction: jest.fn((cb: (m: any) => any) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        WarehouseService,
        { provide: getRepositoryToken(OrderEntity), useValue: orderRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(HubEntity), useValue: hubRepo },
        { provide: getRepositoryToken(TripEntity), useValue: tripRepo },
        {
          provide: getRepositoryToken(OrderInventoryTransactionEntity),
          useValue: txRepo,
        },
        { provide: OrderCodeService, useValue: orderCodeService },
        { provide: OperationalLedgerService, useValue: ledgerService },
        {
          provide: OrderActivityLogService,
          useValue: {
            safeLogActivity: jest.fn().mockResolvedValue(undefined),
            logActivity: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: RedisCacheService,
          useValue: { delByPattern: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: MailService,
          useValue: {
            sendOrderPendingFleetNotification: jest.fn(),
            sendOrderNoVehicleNotification: jest.fn(),
          },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    ordersService = module.get<OrdersService>(OrdersService);
    warehouseService = module.get<WarehouseService>(WarehouseService);
  });

  describe('OrdersService.checkCodeExists', () => {
    it('should never block free-text waybill codes', async () => {
      expect(await ordersService.checkCodeExists('')).toEqual({
        exists: false,
      });
      expect(await ordersService.checkCodeExists('WAYBILL-123')).toEqual({
        exists: false,
      });
    });
  });

  describe('WarehouseService.quickCreateInboundOrder', () => {
    it('should keep a custom orderCode and issues SD trip code + PNK invoice', async () => {
      const result = await warehouseService.quickCreateInboundOrder(
        warehouseUser,
        {
          ...baseDto,
          orderCode: 'CUSTOM-WAYBILL-001',
        },
      );

      expect(result.orderCode).toBe('CUSTOM-WAYBILL-001');
      expect(orderCodeService.generateOrderCode).not.toHaveBeenCalled();
      expect(ledgerService.generateTripCode).toHaveBeenCalled();
      expect(tripRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tripCode: 'SD7',
          licensePlate: '29C-123.45',
        }),
      );
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: InventoryTransactionType.INBOUND,
          invoiceCode: 'PNK-HAN-2610-001',
          hubId: 1,
          tripCode: 'SD7',
          quantity: 20,
        }),
      );
      expect(result.currentHubId).toBe(1);
    });

    it('should auto-generate the order code when omitted', async () => {
      const result = await warehouseService.quickCreateInboundOrder(
        warehouseUser,
        baseDto,
      );
      expect(orderCodeService.generateOrderCode).toHaveBeenCalled();
      expect(result.orderCode).toBe('HAN-OP-2609-099');
    });

    it('should not write an inbound invoice for drafts', async () => {
      await warehouseService.quickCreateInboundOrder(warehouseUser, {
        ...baseDto,
        initialStatus: 'DRAFT',
      } as any);
      expect(txRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('WarehouseService.appendOrderToTrip', () => {
    it('should append an en-route cargo order to an existing tripCode with TRANSFER ledger', async () => {
      tripRepo.find.mockResolvedValue([
        {
          id: 50,
          tripCode: 'SD10',
          licensePlate: '29E-012.45',
          driverName: 'Bác Tài',
          originHubId: 1,
          destinationHubId: 2,
        },
      ]);
      hubRepo.findOne.mockResolvedValue({
        id: 2,
        name: 'Polaris Hub - Hưng Yên',
      });

      const result = await warehouseService.appendOrderToTrip(
        warehouseUser,
        'SD10',
        {
          appendMode: AppendOrderMode.HUB_OUTBOUND,
          goodsDescription: 'Hạt nhựa công nghiệp',
          totalQuantity: 30,
          totalWeight: 600,
          totalVolume: 3,
          destinationHubId: 2,
          notes: 'Bốc thêm dọc đường tại Đà Nẵng',
        },
      );

      expect(result.tripCode).toBe('SD10');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          goodsDescription: 'Hạt nhựa công nghiệp',
          totalQuantity: 30,
          currentTripCode: 'SD10',
          status: 'IN_TRANSIT',
        }),
      );
      expect(tripRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tripCode: 'SD10',
          licensePlate: '29E-012.45',
          driverName: 'Bác Tài',
          type: 'TRANSFER',
          status: 'IN_TRANSIT',
        }),
      );
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: InventoryTransactionType.TRANSFER,
          tripCode: 'SD10',
          licensePlate: '29E-012.45',
          quantity: 30,
        }),
      );
    });
  });

  describe('Master Contract immutability', () => {
    const lockedOrder = {
      id: 5,
      orderCode: 'HAN-OP-2610-005',
      status: 'INBOUND',
      totalQuantity: 20,
      totalWeight: 450,
      totalVolume: 2.5,
      goodsDescription: 'Thùng carton',
      originHubId: 1,
      destinationHubId: 2,
      originHub: 'Hà Nội',
      destinationHub: 'Hồ Chí Minh',
      remainingQuantity: 20,
      isExternalVehicleNeeded: false,
    };

    it('should reject contract changes once the order left DRAFT', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder });
      await expect(
        ordersService.update(5, { totalQuantity: 15 } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('should accept re-sent unchanged contract values', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder });
      await ordersService.update(5, {
        totalQuantity: '20',
        totalWeight: 450,
        notes: 'Ghi chú mới',
      } as any);
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('should allow contract changes while DRAFT', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder, status: 'DRAFT' });
      await ordersService.update(5, { totalQuantity: 15 } as any);
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalQuantity: 15 }),
      );
    });

    it('should restrict admin override to SUPER_ADMIN only', async () => {
      await expect(
        ordersService.adminOverride(
          5,
          { auditReason: 'Khách báo sai số kiện', totalQuantity: 18 } as any,
          warehouseUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should write an ADJUSTMENT invoice with the audit reason on admin override', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder });
      const saved = await ordersService.adminOverride(
        5,
        { auditReason: 'Khách báo sai số kiện', totalQuantity: 18 } as any,
        adminUser,
      );

      expect(saved.totalQuantity).toBe(18);
      expect(saved.remainingQuantity).toBe(20);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: InventoryTransactionType.ADJUSTMENT,
          invoiceCode: 'DCH-SYS-2610-001',
          quantity: 0,
          discrepancyReason: 'Khách báo sai số kiện',
        }),
      );
    });

    it('should reject a no-op change on admin override', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder });
      await expect(
        ordersService.adminOverride(
          5,
          { auditReason: 'Không đổi gì cả', totalQuantity: 20 } as any,
          adminUser,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('Inventory mutation concurrency guard', () => {
    it('should lock the order row before reading stock for outbound confirmation', async () => {
      const order = {
        id: 5,
        orderCode: 'HCM-TEST-005',
        status: 'INBOUND',
        originHubId: 1,
        currentHubId: 1,
        totalQuantity: 5,
        inboundQuantity: 5,
        outboundQuantity: 0,
        remainingQuantity: 5,
        totalWeight: 5,
        totalVolume: 1,
      } as any;
      orderRepo.find.mockResolvedValue([order]);
      orderRepo.save.mockImplementation((data: any) =>
        Promise.resolve(Array.isArray(data) ? data : data),
      );
      ledgerService.getHubStock.mockResolvedValue(5);
      ledgerService.generateTripCode.mockResolvedValue('SD-TEST-005');
      ledgerService.generateInvoiceCode.mockResolvedValue('PXK-TEST-005');

      await warehouseService.confirmOutbound(warehouseUser, {
        orderIds: [5],
        items: [
          {
            orderId: 5,
            quantityToExport: 5,
            deliveryMode: 'DIRECT_CUSTOMER',
          },
        ],
        licensePlate: 'TEST-001',
        driverName: 'Test Driver',
      } as any);

      expect(manager.query).toHaveBeenCalledWith(
        expect.stringContaining('FOR UPDATE'),
        [[5], []],
      );
      expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(
        ledgerService.getHubStock.mock.invocationCallOrder[0],
      );
      expect(ledgerService.getHubStock).toHaveBeenCalledWith(5, 1, manager);
    });

    it('should reject outbound quantity above the ledger stock even when the order counter is stale', async () => {
      orderRepo.find.mockResolvedValue([
        {
          id: 6,
          orderCode: 'HCM-TEST-006',
          status: 'INBOUND',
          originHubId: 1,
          currentHubId: 1,
          totalQuantity: 306,
          inboundQuantity: 306,
          outboundQuantity: 0,
          remainingQuantity: 306,
        } as any,
      ]);
      ledgerService.getHubStock.mockResolvedValue(5);

      await expect(
        warehouseService.confirmOutbound(warehouseUser, {
          orderIds: [6],
          items: [
            {
              orderId: 6,
              quantityToExport: 6,
              deliveryMode: 'DIRECT_CUSTOMER',
            },
          ],
        } as any),
      ).rejects.toThrow(/vượt quá tồn kho khả dụng/i);

      expect(txRepo.save).not.toHaveBeenCalled();
      expect(tripRepo.save).not.toHaveBeenCalled();
    });

    it('should use ledger stock, not the stale order counter, when appending stored cargo', async () => {
      const order = {
        id: 7,
        orderCode: 'HCM-TEST-007',
        status: 'INBOUND',
        originHubId: 1,
        currentHubId: 1,
        totalQuantity: 100,
        inboundQuantity: 100,
        outboundQuantity: 0,
        remainingQuantity: 100,
        totalWeight: 100,
        totalVolume: 10,
        route: 'HCM → HẢI PHÒNG',
      } as any;
      const queryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([order]),
      };
      (orderRepo as any).createQueryBuilder = jest
        .fn()
        .mockReturnValue(queryBuilder);
      tripRepo.find.mockResolvedValue([
        {
          id: 70,
          tripCode: 'SD-TEST-007',
          originHubId: 1,
          licensePlate: 'TEST-007',
          driverName: 'Test Driver',
        },
      ]);
      ledgerService.getHubStock.mockResolvedValue(5);

      await warehouseService.appendStoredOrdersToTrip(
        warehouseUser,
        'SD-TEST-007',
        { orderIds: [7], hubId: 1 } as any,
      );

      expect(ledgerService.getHubStock).toHaveBeenCalledWith(7, 1, manager);
      expect(txRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5 }),
      );
      expect(order.outboundQuantity).toBe(5);
      expect(order.remainingQuantity).toBe(95);
    });
  });
});
