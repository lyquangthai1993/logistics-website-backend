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
import { OrderCodeService } from './order-code.service';
import { OperationalLedgerService } from './operational-ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { DeliveryDestinationMode } from './dto/quick-create-inbound-order.dto';
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
    .mockImplementation((data) => Promise.resolve({ id: data.id ?? 101, ...data })),
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

  const hub = { id: 1, name: 'Andromeda Hub (Hà Nội)', code: 'HUB-HAN-01', isActive: true };

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
    userRepo = makeRepo({ findOne: jest.fn().mockResolvedValue(warehouseUser) });
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
    };

    const repoByEntity = new Map<any, any>([
      [OrderEntity, orderRepo],
      [UserEntity, userRepo],
      [HubEntity, hubRepo],
      [TripEntity, tripRepo],
      [OrderInventoryTransactionEntity, txRepo],
    ]);
    const manager = {
      getRepository: jest.fn((entity: any) => repoByEntity.get(entity)),
      query: jest.fn().mockResolvedValue([]),
    };
    const dataSource = {
      manager,
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
    it('never blocks free-text waybill codes', async () => {
      expect(await ordersService.checkCodeExists('')).toEqual({ exists: false });
      expect(await ordersService.checkCodeExists('WAYBILL-123')).toEqual({
        exists: false,
      });
    });
  });

  describe('WarehouseService.quickCreateInboundOrder', () => {
    it('keeps a custom orderCode and issues SD trip code + PNK invoice', async () => {
      const result = await warehouseService.quickCreateInboundOrder(warehouseUser, {
        ...baseDto,
        orderCode: 'CUSTOM-WAYBILL-001',
      });

      expect(result.orderCode).toBe('CUSTOM-WAYBILL-001');
      expect(orderCodeService.generateOrderCode).not.toHaveBeenCalled();
      expect(ledgerService.generateTripCode).toHaveBeenCalled();
      expect(tripRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tripCode: 'SD7', licensePlate: '29C-123.45' }),
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

    it('auto-generates the order code when omitted', async () => {
      const result = await warehouseService.quickCreateInboundOrder(
        warehouseUser,
        baseDto,
      );
      expect(orderCodeService.generateOrderCode).toHaveBeenCalled();
      expect(result.orderCode).toBe('HAN-OP-2609-099');
    });

    it('does not write an inbound invoice for drafts', async () => {
      await warehouseService.quickCreateInboundOrder(warehouseUser, {
        ...baseDto,
        initialStatus: 'DRAFT',
      } as any);
      expect(txRepo.save).not.toHaveBeenCalled();
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

    it('rejects contract changes once the order left DRAFT', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder });
      await expect(
        ordersService.update(5, { totalQuantity: 15 } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('accepts re-sent unchanged contract values', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder });
      await ordersService.update(5, {
        totalQuantity: '20',
        totalWeight: 450,
        notes: 'Ghi chú mới',
      } as any);
      expect(orderRepo.save).toHaveBeenCalled();
    });

    it('allows contract changes while DRAFT', async () => {
      orderRepo.findOne.mockResolvedValue({ ...lockedOrder, status: 'DRAFT' });
      await ordersService.update(5, { totalQuantity: 15 } as any);
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ totalQuantity: 15 }),
      );
    });

    it('admin override is SUPER_ADMIN only', async () => {
      await expect(
        ordersService.adminOverride(
          5,
          { auditReason: 'Khách báo sai số kiện', totalQuantity: 18 } as any,
          warehouseUser,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin override writes an ADJUSTMENT invoice with the audit reason', async () => {
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

    it('admin override rejects a no-op change', async () => {
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
});
