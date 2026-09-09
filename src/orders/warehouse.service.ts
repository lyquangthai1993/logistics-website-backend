import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { TripEntity } from '../trips/infrastructure/persistence/relational/entities/trip.entity';
import { OrderCodeService } from './order-code.service';
import { RoleEnum } from '../roles/roles.enum';
import {
  QuickCreateInboundOrderDto,
  DeliveryDestinationMode,
} from './dto/quick-create-inbound-order.dto';
import { ConfirmOutboundDto, OutboundMode } from './dto/confirm-outbound.dto';

export interface WarehouseOrdersResult {
  data: OrderEntity[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    totalQuantity: number;
    totalWeight: number;
    totalVolume: number;
  };
}

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger(WarehouseService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(HubEntity)
    private readonly hubRepository: Repository<HubEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(TripEntity)
    private readonly tripRepository: Repository<TripEntity>,
    private readonly orderCodeService: OrderCodeService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * List or Lookup warehouse orders with Freetext Search, Status Filter & Pagination.
   * Strict Hub Scoping for WAREHOUSE_MANAGER.
   */
  async getOrders(
    user: UserEntity,
    query: {
      search?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<WarehouseOrdersResult> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
      .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
      .leftJoinAndSelect('order.trips', 'trips')
      .where('order.deletedAt IS NULL');

    // Strict Hub Scoping for Warehouse Manager
    if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER && user.hubId) {
      qb.andWhere(
        '(order.originHubId = :userHubId OR order.destinationHubId = :userHubId)',
        { userHubId: user.hubId },
      );
    }

    // Status Filter (LƯU KHO = INBOUND, ĐÃ XUẤT KHO = COMPLETED_INBOUND)
    if (query?.status && query.status !== 'ALL') {
      const statusUpper = query.status.toUpperCase();
      if (
        statusUpper === 'LƯU KHO' ||
        statusUpper === 'INBOUND' ||
        statusUpper === 'LUU_KHO' ||
        statusUpper === 'STORED'
      ) {
        qb.andWhere('order.status = :st', { st: 'INBOUND' });
      } else if (
        statusUpper === 'DRAFT' ||
        statusUpper === 'WAITING' ||
        statusUpper === 'CHO_NHAP'
      ) {
        qb.andWhere("order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND')");
      } else if (statusUpper === 'CUSTOMER' || statusUpper === 'KHACH_GUI') {
        qb.andWhere(
          "order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND') AND (order.inboundType = 'CUSTOMER' OR order.orderCode NOT LIKE 'TRIP%')",
        );
      } else if (statusUpper === 'TRANSFER' || statusUpper === 'LUAN_CHUYEN') {
        qb.andWhere(
          "order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND') AND (order.inboundType = 'TRANSFER' OR order.orderCode LIKE 'TRIP%')",
        );
      } else if (
        statusUpper === 'ĐÃ XUẤT KHO' ||
        statusUpper === 'COMPLETED_INBOUND' ||
        statusUpper === 'DA_XUAT_KHO'
      ) {
        qb.andWhere(
          "order.status IN ('COMPLETED_INBOUND', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED_OUTBOUND')",
        );
      } else if (statusUpper === 'PENDING_INBOUND') {
        qb.andWhere('order.status = :st', { st: 'PENDING_INBOUND' });
      } else {
        qb.andWhere('order.status = :st', { st: query.status });
      }
    }

    // Freetext Search: orderCode OR goodsDescription (No location lookup)
    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search)',
        { search },
      );
    }

    qb.orderBy('order.createdAt', 'DESC');

    const [data, total] = await qb.skip(skip).take(limit).getManyAndCount();

    // Summary totals of current dataset
    const totalQuantity = data.reduce(
      (sum, item) => sum + (Number(item.totalQuantity) || 0),
      0,
    );
    const totalWeight = data.reduce(
      (sum, item) => sum + (Number(item.totalWeight) || 0),
      0,
    );
    const totalVolume = data.reduce(
      (sum, item) => sum + (Number(item.totalVolume) || 0),
      0,
    );

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        totalQuantity,
        totalWeight,
        totalVolume,
      },
    };
  }

  /**
   * Quick create inbound order row from warehouse (Mode 1).
   * Generates code atomically via OrderCodeService, sets status = 'INBOUND' (LƯU KHO).
   */
  async quickCreateInboundOrder(
    user: UserEntity,
    dto: QuickCreateInboundOrderDto,
  ): Promise<OrderEntity> {
    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });

    if (!userWithHub) {
      throw new NotFoundException('Không tìm thấy tài khoản người dùng');
    }

    // Server generates canonical orderCode atomically
    const orderCode = await this.orderCodeService.generateOrderCode(userWithHub);

    let destinationHubName: string | null = null;
    if (dto.destinationHubId) {
      const destHub = await this.hubRepository.findOne({
        where: { id: dto.destinationHubId },
      });
      if (destHub) {
        destinationHubName = destHub.name;
      }
    }

    const originHubId = userWithHub.hubId || null;
    const originHubName = userWithHub.hub?.name || null;

    const initialStatus = dto.initialStatus || 'INBOUND'; // LƯU KHO

    const order = this.orderRepository.create({
      orderCode,
      goodsDescription: dto.goodsDescription.trim(),
      totalQuantity: dto.totalQuantity,
      totalWeight: dto.totalWeight,
      totalVolume: dto.totalVolume,
      route: `${originHubName || 'Hub'} → ${dto.deliveryAddress || destinationHubName || 'Điểm đến'}`,
      originHub: originHubName,
      originHubId,
      destinationHub: destinationHubName,
      destinationHubId: dto.destinationHubId || null,
      notes: dto.notes?.trim() || null,
      status: initialStatus,
      createdByUserId: user.id,
      isExternalVehicleNeeded: false,
    });

    return this.orderRepository.save(order);
  }

  /**
   * Confirm inbound orders (Transition status to 'INBOUND' / LƯU KHO).
   */
  async confirmInbound(
    user: UserEntity,
    orderIds: number[],
  ): Promise<{ updatedCount: number; orders: OrderEntity[] }> {
    if (!orderIds || orderIds.length === 0) {
      throw new UnprocessableEntityException('Danh sách đơn hàng không được để trống');
    }

    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
    });

    if (orders.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng nào');
    }

    for (const order of orders) {
      order.status = 'INBOUND'; // LƯU KHO
    }

    const saved = await this.orderRepository.save(orders);
    return {
      updatedCount: saved.length,
      orders: saved,
    };
  }

  /**
   * Confirm outbound dispatch (Mode 1: Customer vs Mode 2: Transfer).
   */
  async confirmOutbound(
    user: UserEntity,
    dto: ConfirmOutboundDto,
  ): Promise<{ updatedCount: number; orders: OrderEntity[] }> {
    const orders = await this.orderRepository.find({
      where: { id: In(dto.orderIds) },
    });

    if (orders.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
    }

    for (const order of orders) {
      if (dto.mode === OutboundMode.CUSTOMER) {
        order.status = 'COMPLETED_INBOUND'; // ĐÃ XUẤT KHO (chuyển sang giao khách)
      } else {
        order.status = 'COMPLETED_INBOUND'; // ĐÃ XUẤT KHO (luân chuyển)
        if (dto.destinationHubId) {
          order.destinationHubId = dto.destinationHubId;
        }
      }
    }

    const saved = await this.orderRepository.save(orders);
    return {
      updatedCount: saved.length,
      orders: saved,
    };
  }

  /**
   * Get KPI metrics for warehouse dashboard cards & tab counters.
   */
  async getKpiStats(user: UserEntity): Promise<{
    total: number;
    waitingInbound: number;
    customerInbound: number;
    transferInbound: number;
    storedInbound: number;
    waitingOutbound: number;
    completedOutboundToday: number;
  }> {
    const hubCondition =
      user.role?.id === RoleEnum.WAREHOUSE_MANAGER && user.hubId
        ? `AND (order.originHubId = ${user.hubId} OR order.destinationHubId = ${user.hubId})`
        : '';

    const raw = await this.orderRepository
      .createQueryBuilder('order')
      .select([
        `COUNT(order.id) as "total"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND') THEN 1 END) as "waitingInbound"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND') AND (order.inboundType = 'CUSTOMER' OR order.orderCode NOT LIKE 'TRIP%') THEN 1 END) as "customerInbound"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND') AND (order.inboundType = 'TRANSFER' OR order.orderCode LIKE 'TRIP%') THEN 1 END) as "transferInbound"`,
        `COUNT(CASE WHEN order.status = 'INBOUND' THEN 1 END) as "storedInbound"`,
        `COUNT(CASE WHEN order.status IN ('INBOUND', 'DRAFT', 'PENDING_FLEET') THEN 1 END) as "waitingOutbound"`,
        `COUNT(CASE WHEN order.status IN ('COMPLETED_INBOUND', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED_OUTBOUND') AND order.updatedAt >= CURRENT_DATE THEN 1 END) as "completedOutboundToday"`,
      ])
      .where(`order.deletedAt IS NULL ${hubCondition}`)
      .getRawOne();

    return {
      total: Number(raw?.total) || 0,
      waitingInbound: Number(raw?.waitingInbound) || 0,
      customerInbound: Number(raw?.customerInbound) || 0,
      transferInbound: Number(raw?.transferInbound) || 0,
      storedInbound: Number(raw?.storedInbound) || 0,
      waitingOutbound: Number(raw?.waitingOutbound) || 0,
      completedOutboundToday: Number(raw?.completedOutboundToday) || 0,
    };
  }

  /**
   * List Inbound Trips approaching current Hub.
   */
  async getInboundTrips(
    user: UserEntity,
    query: {
      search?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: any[]; meta: any }> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const qb = this.tripRepository
      .createQueryBuilder('trip')
      .leftJoinAndSelect('trip.vehicle', 'vehicle')
      .leftJoinAndSelect('trip.driver', 'driver')
      .leftJoinAndSelect('trip.order', 'order')
      .where('trip.deletedAt IS NULL');

    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(trip.tripCode ILIKE :search OR vehicle.licensePlate ILIKE :search OR driver.fullName ILIKE :search)',
        { search },
      );
    }

    qb.orderBy('trip.createdAt', 'DESC');

    const [trips, total] = await qb.skip(skip).take(limit).getManyAndCount();

    const formatted = trips.map((t) => ({
      id: t.id,
      tripCode: `TRIP-${t.id}`,
      vehicleLicensePlate: t.vehicle?.licensePlate || 'Chưa gán xe',
      vehicleType: t.vehicle?.type || 'Tải thùng kín',
      driverName: t.driver?.fullName || 'Chưa gán tài xế',
      driverPhone: t.driver?.phone || '',
      status: t.status,
      originHub: t.order?.originHub || 'Hub xuất phát',
      destinationHub: t.order?.destinationHub || 'Hub nhận',
      remainingOrdersCount: t.order ? 1 : 0,
      totalWeight: t.order?.totalWeight || 0,
      totalVolume: t.order?.totalVolume || 0,
      order: t.order,
    }));

    return {
      data: formatted,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
