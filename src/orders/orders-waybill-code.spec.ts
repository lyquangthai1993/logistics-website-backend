import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { OrdersService } from './orders.service';
import { WarehouseService } from './warehouse.service';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { TripEntity } from '../trips/infrastructure/persistence/relational/entities/trip.entity';
import { OrderCodeService } from './order-code.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { DeliveryDestinationMode } from './dto/quick-create-inbound-order.dto';

describe('Orders & Warehouse Waybill Free Input & Duplicate Check', () => {
  let ordersService: OrdersService;
  let warehouseService: WarehouseService;
  let orderRepo: any;
  let userRepo: any;
  let hubRepo: any;
  let orderCodeService: any;

  const mockUser: any = {
    id: 1,
    email: 'warehouse@test.com',
    hubId: 1,
    hub: { id: 1, name: 'Andromeda Hub (Hà Nội)', code: 'HUB-HAN-01', isActive: true },
    role: { id: 4, name: 'WAREHOUSE_MANAGER' },
  };

  beforeEach(async () => {
    orderRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn().mockImplementation((data) => ({ id: 101, ...data })),
      save: jest.fn().mockImplementation((data) => Promise.resolve(data)),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
    };

    hubRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser.hub),
    };

    orderCodeService = {
      generateOrderCode: jest.fn().mockResolvedValue('HAN-OP-2609-099'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        WarehouseService,
        {
          provide: getRepositoryToken(OrderEntity),
          useValue: orderRepo,
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepo,
        },
        {
          provide: getRepositoryToken(HubEntity),
          useValue: hubRepo,
        },
        {
          provide: getRepositoryToken(TripEntity),
          useValue: { findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: OrderCodeService,
          useValue: orderCodeService,
        },
        {
          provide: NotificationsService,
          useValue: { create: jest.fn() },
        },
        {
          provide: MailService,
          useValue: { sendOrderPendingFleetNotification: jest.fn(), sendOrderNoVehicleNotification: jest.fn() },
        },
        {
          provide: DataSource,
          useValue: { manager: {} },
        },
      ],
    }).compile();

    ordersService = module.get<OrdersService>(OrdersService);
    warehouseService = module.get<WarehouseService>(WarehouseService);
  });

  describe('OrdersService.checkCodeExists', () => {
    it('should return false if code is empty or placeholder', async () => {
      expect(await ordersService.checkCodeExists('')).toEqual({ exists: false });
      expect(await ordersService.checkCodeExists('   ')).toEqual({ exists: false });
      expect(await ordersService.checkCodeExists('(Tự sinh khi lưu)')).toEqual({ exists: false });
    });

    it('should return exists: true with message when code already exists in DB', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 1, orderCode: 'WAYBILL-123' });

      const res = await ordersService.checkCodeExists('WAYBILL-123');
      expect(res.exists).toBe(true);
      expect(res.message).toContain('đã tồn tại trong hệ thống');
      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { orderCode: 'WAYBILL-123' },
      });
    });

    it('should return exists: false when code is unique and not in DB', async () => {
      orderRepo.findOne.mockResolvedValue(null);

      const res = await ordersService.checkCodeExists('UNIQUE-CODE-888');
      expect(res.exists).toBe(false);
      expect(res.message).toBeUndefined();
    });
  });

  describe('WarehouseService.quickCreateInboundOrder', () => {
    it('should accept custom orderCode and save when not duplicate', async () => {
      orderRepo.findOne.mockResolvedValue(null); // not duplicate

      const dto = {
        orderCode: 'CUSTOM-WAYBILL-001',
        goodsDescription: 'Thùng carton linh kiện',
        totalQuantity: 20,
        totalWeight: 450,
        totalVolume: 2.5,
        deliveryMode: DeliveryDestinationMode.DIRECT_CUSTOMER,
        deliveryAddress: '123 Cầu Giấy, Hà Nội',
      };

      const result = await warehouseService.quickCreateInboundOrder(mockUser, dto);

      expect(orderRepo.findOne).toHaveBeenCalledWith({
        where: { orderCode: 'CUSTOM-WAYBILL-001' },
      });
      expect(result.orderCode).toBe('CUSTOM-WAYBILL-001');
      expect(orderCodeService.generateOrderCode).not.toHaveBeenCalled();
    });

    it('should throw UnprocessableEntityException when custom orderCode already exists in DB', async () => {
      orderRepo.findOne.mockResolvedValue({ id: 99, orderCode: 'DUPLICATE-CODE' }); // already exists

      const dto = {
        orderCode: 'DUPLICATE-CODE',
        goodsDescription: 'Thùng carton linh kiện',
        totalQuantity: 20,
        totalWeight: 450,
        totalVolume: 2.5,
        deliveryMode: DeliveryDestinationMode.DIRECT_CUSTOMER,
        deliveryAddress: '123 Cầu Giấy, Hà Nội',
      };

      await expect(
        warehouseService.quickCreateInboundOrder(mockUser, dto),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('should auto-generate code when orderCode is omitted or placeholder', async () => {
      const dto = {
        goodsDescription: 'Thùng carton linh kiện',
        totalQuantity: 20,
        totalWeight: 450,
        totalVolume: 2.5,
        deliveryMode: DeliveryDestinationMode.DIRECT_CUSTOMER,
        deliveryAddress: '123 Cầu Giấy, Hà Nội',
      };

      const result = await warehouseService.quickCreateInboundOrder(mockUser, dto);

      expect(orderCodeService.generateOrderCode).toHaveBeenCalled();
      expect(result.orderCode).toBe('HAN-OP-2609-099');
    });
  });

  describe('WarehouseService.confirmInbound', () => {
    it('should use custom orderCode for new en-route custom rows if not duplicate', async () => {
      orderRepo.findOne.mockResolvedValue(null); // not found in DB

      const body = {
        orders: [
          {
            orderCode: 'ENROUTE-999',
            goodsDescription: 'Hàng dọc đường',
            totalQuantity: 5,
            totalWeight: 100,
            totalVolume: 0.5,
          },
        ],
      };

      const result = await warehouseService.confirmInbound(mockUser, body);

      expect(result.newCount).toBe(1);
      expect(result.orders[0].orderCode).toBe('ENROUTE-999');
    });

    it('should throw UnprocessableEntityException if custom en-route code is duplicate with another existing order', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 88, orderCode: 'ENROUTE-DUP' });

      const body = {
        orders: [
          {
            orderCode: 'ENROUTE-DUP',
            goodsDescription: 'Hàng dọc đường',
            totalQuantity: 5,
            totalWeight: 100,
            totalVolume: 0.5,
          },
        ],
      };

      await expect(
        warehouseService.confirmInbound(mockUser, body),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });
});
