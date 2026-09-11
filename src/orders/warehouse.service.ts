import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
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
    allCount?: number;
    storedCount?: number;
    draftCount?: number;
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
   * Helper to resolve hubId from user entity or DB when missing on JWT payload.
   */
  private async resolveUserHubId(user: UserEntity): Promise<number | null | undefined> {
    if (user.hubId) return user.hubId;
    if (!user.id) return undefined;
    const dbUser = await this.userRepository.findOne({
      where: { id: user.id },
      select: ['id', 'hubId'],
    });
    return dbUser?.hubId ?? null;
  }

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
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<WarehouseOrdersResult> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 20));
    const skip = (page - 1) * limit;

    const userHubId = await this.resolveUserHubId(user);

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
      .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
      .leftJoinAndSelect('order.trips', 'trips')
      .where('order.deletedAt IS NULL');

    // Scoping for Warehouse Manager: Include hub-bound orders and unassigned orders
    if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER && userHubId) {
      qb.andWhere(
        '(order.originHubId = :userHubId OR order.destinationHubId = :userHubId OR order.originHubId IS NULL)',
        { userHubId },
      );
    }

    // Dynamic counts for status tabs based on current hub scope
    const countQb = this.orderRepository
      .createQueryBuilder('order')
      .where('order.deletedAt IS NULL');

    if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER && userHubId) {
      countQb.andWhere(
        '(order.originHubId = :userHubId OR order.destinationHubId = :userHubId OR order.originHubId IS NULL)',
        { userHubId },
      );
    }

    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      countQb.andWhere(
        '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search)',
        { search },
      );
    }

    if (query?.fromDate) {
      const from = new Date(`${query.fromDate}T00:00:00`);
      qb.andWhere('(order.createdAt >= :fromDate OR order.updatedAt >= :fromDate)', {
        fromDate: from.toISOString(),
      });
      countQb.andWhere('(order.createdAt >= :fromDate OR order.updatedAt >= :fromDate)', {
        fromDate: from.toISOString(),
      });
    }

    if (query?.toDate) {
      const to = new Date(`${query.toDate}T23:59:59.999`);
      qb.andWhere('(order.createdAt <= :toDate OR order.updatedAt <= :toDate)', {
        toDate: to.toISOString(),
      });
      countQb.andWhere('(order.createdAt <= :toDate OR order.updatedAt <= :toDate)', {
        toDate: to.toISOString(),
      });
    }

    const countsRaw = await countQb
      .select([
        `COUNT(order.id) as "totalCount"`,
        `COUNT(CASE WHEN order.status IN ('INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') THEN 1 END) as "storedCount"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING') THEN 1 END) as "draftCount"`,
      ])
      .getRawOne();

    const storedCount = Number(countsRaw?.storedCount) || 0;
    const draftCount = Number(countsRaw?.draftCount) || 0;
    const allCount = Number(countsRaw?.totalCount) || 0;

    // Status Filter (Standard Uppercase Enum Keys)
    if (query?.status && query.status.toUpperCase() !== 'ALL') {
      const statusUpper = query.status.toUpperCase();
      switch (statusUpper) {
        case 'INBOUND':
        case 'STORED':
        case 'IN_WAREHOUSE':
          qb.andWhere("order.status IN ('INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE')");
          break;
        case 'WAITING':
        case 'DRAFT':
          qb.andWhere("order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING')");
          break;
        case 'CUSTOMER':
          qb.andWhere(
            "order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING', 'INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') AND NOT ((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub) OR EXISTS (SELECT 1 FROM trip t WHERE t.\"orderId\" = order.id AND t.\"deletedAt\" IS NULL))",
          );
          break;
        case 'TRANSFER':
          qb.andWhere(
            "order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING', 'INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') AND (((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub)) OR EXISTS (SELECT 1 FROM trip t WHERE t.\"orderId\" = order.id AND t.\"deletedAt\" IS NULL))",
          );
          break;
        case 'COMPLETED_INBOUND':
          qb.andWhere(
            "order.status IN ('COMPLETED_INBOUND', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED_OUTBOUND')",
          );
          break;
        case 'PENDING_INBOUND':
          qb.andWhere("order.status IN ('PENDING_INBOUND', 'WAITING')");
          break;
        default:
          qb.andWhere('order.status = :st', { st: query.status });
          break;
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
        allCount,
        storedCount,
        draftCount,
      },
    };
  }

  /**
   * Quick create inbound order row from warehouse.
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
      throw new UnauthorizedException(
        'Tài khoản không tồn tại trên hệ thống hoặc phiên đăng nhập đã cũ. Vui lòng đăng nhập lại.',
      );
    }

    // Check if client provided custom orderCode
    let finalOrderCode = dto.orderCode?.trim();
    if (
      finalOrderCode &&
      finalOrderCode !== '(Tự sinh khi lưu)' &&
      !finalOrderCode.startsWith('(Tự sinh')
    ) {
      const existing = await this.orderRepository.findOne({
        where: { orderCode: finalOrderCode },
      });
      if (existing) {
        throw new UnprocessableEntityException(
          `Mã vận đơn '${finalOrderCode}' đã tồn tại trên hệ thống, vui lòng nhập mã khác.`,
        );
      }
    } else {
      // Server generates canonical orderCode atomically
      finalOrderCode = await this.orderCodeService.generateOrderCode(userWithHub);
    }

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
      orderCode: finalOrderCode,
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
   * Supports both simple orderIds array and structured grid rows (existing + new en-route orders).
   */
  async confirmInbound(
    user: UserEntity,
    body: any,
  ): Promise<{ updatedCount: number; newCount?: number; orders: OrderEntity[] }> {
    let orderIds: number[] = [];
    let customOrders: any[] = [];
    let tripId: number | undefined;

    if (Array.isArray(body)) {
      orderIds = body;
    } else if (body?.orderIds && Array.isArray(body.orderIds)) {
      orderIds = body.orderIds;
    } else if (body?.orders && Array.isArray(body.orders)) {
      customOrders = body.orders;
      tripId = body.tripId;
    } else {
      throw new UnprocessableEntityException('Dữ liệu tiếp nhận kho không hợp lệ');
    }

    const savedOrders: OrderEntity[] = [];
    let newCreatedCount = 0;

    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });

    // 1. Process explicit orderIds if any
    if (orderIds.length > 0) {
      const existing = await this.orderRepository.find({
        where: { id: In(orderIds) },
      });
      for (const order of existing) {
        order.status = 'INBOUND'; // LƯU KHO
        if (userWithHub?.hubId) {
          order.originHubId = userWithHub.hubId;
          order.originHub = userWithHub.hub?.name || order.originHub;
        }
      }
      const saved = await this.orderRepository.save(existing);
      savedOrders.push(...saved);
    }

    // 2. Process customOrders (from 10-column grid)
    if (customOrders.length > 0) {
      for (const row of customOrders) {
        const hasSpecificCode =
          row.orderCode &&
          row.orderCode !== '(Tự sinh khi lưu)' &&
          !row.orderCode.startsWith('(Tự sinh');

        let foundOrder: OrderEntity | null = null;
        if (hasSpecificCode) {
          foundOrder = await this.orderRepository.findOne({
            where: { orderCode: row.orderCode },
          });
        }

        if (foundOrder) {
          // Existing order unloaded from trip -> Update to INBOUND at current Hub
          foundOrder.status = 'INBOUND';
          if (userWithHub?.hubId) {
            foundOrder.originHubId = userWithHub.hubId;
            foundOrder.originHub = userWithHub.hub?.name || foundOrder.originHub;
          }
          if (row.notes) {
            foundOrder.notes = row.notes;
          }
          const saved = await this.orderRepository.save(foundOrder);
          savedOrders.push(saved);
        } else {
          // New row added en-route! Use custom orderCode if provided, or generate atomically
          let newOrderCode = row.orderCode?.trim();
          if (hasSpecificCode && newOrderCode) {
            const duplicate = await this.orderRepository.findOne({
              where: { orderCode: newOrderCode },
            });
            if (duplicate) {
              throw new UnprocessableEntityException(
                `Mã vận đơn '${newOrderCode}' đã tồn tại trên hệ thống, vui lòng nhập mã khác.`,
              );
            }
          } else {
            newOrderCode = userWithHub
              ? await this.orderCodeService.generateOrderCode(userWithHub)
              : `ORD-${Date.now()}`;
          }

          const newOrder = this.orderRepository.create({
            orderCode: newOrderCode,
            goodsDescription: (row.goodsDescription || 'Hàng gom luân chuyển').trim(),
            totalQuantity: Number(row.totalQuantity) || 1,
            totalWeight: Number(row.totalWeight) || 0,
            totalVolume: Number(row.totalVolume) || 0,
            route: `${userWithHub?.hub?.name || 'Hub'} → ${row.deliveryAddress || 'Điểm giao'}`,
            originHub: userWithHub?.hub?.name || null,
            originHubId: userWithHub?.hubId || null,
            destinationHub: row.destinationHub || null,
            destinationHubId: row.destinationHubId || null,
            notes: row.notes || 'Hàng lấy thêm dọc đường luân chuyển',
            status: 'INBOUND',
            createdByUserId: user.id,
            isExternalVehicleNeeded: false,
          });

          const savedNew = await this.orderRepository.save(newOrder);
          savedOrders.push(savedNew);
          newCreatedCount++;
        }
      }
    }

    // 3. Update trip if tripId was provided
    if (tripId) {
      const trip = await this.tripRepository.findOne({ where: { id: tripId } });
      if (trip) {
        trip.notes = (trip.notes ? `${trip.notes} · ` : '') + `Đã dỡ hàng tại ${userWithHub?.hub?.name || 'Hub'}`;
        await this.tripRepository.save(trip);
      }
    }

    return {
      updatedCount: savedOrders.length - newCreatedCount,
      newCount: newCreatedCount,
      orders: savedOrders,
    };
  }

  /**
   * Confirm outbound dispatch (Customer vs Transfer).
   */
  async confirmOutbound(
    user: UserEntity,
    dto: ConfirmOutboundDto,
  ): Promise<{ updatedCount: number; orders: OrderEntity[]; trip?: TripEntity }> {
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

    let createdTrip: TripEntity | undefined;
    if (dto.mode === OutboundMode.TRANSFER) {
      let destHubName = '';
      if (dto.destinationHubId) {
        const destHub = await this.hubRepository.findOne({
          where: { id: dto.destinationHubId },
        });
        if (destHub) {
          destHubName = destHub.name;
        }
      }

      const totalWeight = orders.reduce(
        (sum, o) => sum + (Number(o.totalWeight) || 0),
        0,
      );
      const totalVolume = orders.reduce(
        (sum, o) => sum + (Number(o.totalVolume) || 0),
        0,
      );

      createdTrip = this.tripRepository.create({
        orderId: orders[0].id,
        licensePlate: dto.licensePlate || '29C-888.99',
        driverName: dto.driverName || 'Tài xế luân chuyển',
        status: 'IN_TRANSIT',
        pickupDate: (dto as any).dispatchDate || new Date().toISOString().split('T')[0],
        weightAllocated: totalWeight,
        volumeAllocated: totalVolume,
        notes: `Chuyến xe luân chuyển ${orders.length} đơn hàng đến ${destHubName || 'Kho đích'}`,
      });
      createdTrip = await this.tripRepository.save(createdTrip);
    }

    return {
      updatedCount: saved.length,
      orders: saved,
      trip: createdTrip,
    };
  }

  /**
   * Get KPI metrics for warehouse dashboard cards & tab counters.
   */
  async getKpiStats(
    user: UserEntity,
    query?: {
      fromDate?: string;
      toDate?: string;
    },
  ): Promise<{
    total: number;
    waitingInbound: number;
    customerInbound: number;
    transferInbound: number;
    storedInbound: number;
    waitingOutbound: number;
    customerOutbound: number;
    transferOutbound: number;
    completedOutboundToday: number;
    completedOutbound: number;
  }> {
    const userHubId = await this.resolveUserHubId(user);

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .select([
        `COUNT(order.id) as "total"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING') THEN 1 END) as "waitingInbound"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING') AND NOT ((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub) OR EXISTS (SELECT 1 FROM trip t WHERE t.\"orderId\" = order.id AND t.\"deletedAt\" IS NULL)) THEN 1 END) as "customerInbound"`,
        `COUNT(CASE WHEN order.status IN ('DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING') AND (((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub)) OR EXISTS (SELECT 1 FROM trip t WHERE t.\"orderId\" = order.id AND t.\"deletedAt\" IS NULL)) THEN 1 END) as "transferInbound"`,
        `COUNT(CASE WHEN order.status IN ('INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') THEN 1 END) as "storedInbound"`,
        `COUNT(CASE WHEN order.status IN ('INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') THEN 1 END) as "waitingOutbound"`,
        `COUNT(CASE WHEN order.status IN ('INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') AND NOT ((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub)) THEN 1 END) as "customerOutbound"`,
        `COUNT(CASE WHEN order.status IN ('INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE') AND (((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub))) THEN 1 END) as "transferOutbound"`,
        `COUNT(CASE WHEN order.status IN ('COMPLETED_INBOUND', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED_OUTBOUND') THEN 1 END) as "completedOutbound"`,
        `COUNT(CASE WHEN order.status IN ('COMPLETED_INBOUND', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED_OUTBOUND') THEN 1 END) as "completedOutboundToday"`,
      ])
      .where('order.deletedAt IS NULL');

    if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER && userHubId) {
      qb.andWhere(
        '(order.originHubId = :userHubId OR order.destinationHubId = :userHubId OR order.originHubId IS NULL)',
        { userHubId },
      );
    }

    if (query?.fromDate) {
      const from = new Date(`${query.fromDate}T00:00:00`);
      qb.andWhere('(order.createdAt >= :fromDate OR order.updatedAt >= :fromDate)', {
        fromDate: from.toISOString(),
      });
    }

    if (query?.toDate) {
      const to = new Date(`${query.toDate}T23:59:59.999`);
      qb.andWhere('(order.createdAt <= :toDate OR order.updatedAt <= :toDate)', {
        toDate: to.toISOString(),
      });
    }

    const raw = await qb.getRawOne();

    return {
      total: Number(raw?.total) || 0,
      waitingInbound: Number(raw?.waitingInbound) || 0,
      customerInbound: Number(raw?.customerInbound) || 0,
      transferInbound: Number(raw?.transferInbound) || 0,
      storedInbound: Number(raw?.storedInbound) || 0,
      waitingOutbound: Number(raw?.waitingOutbound) || 0,
      customerOutbound: Number(raw?.customerOutbound) || 0,
      transferOutbound: Number(raw?.transferOutbound) || 0,
      completedOutbound: Number(raw?.completedOutbound) || 0,
      completedOutboundToday: Number(raw?.completedOutboundToday) || Number(raw?.completedOutbound) || 0,
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

    const userHubId = await this.resolveUserHubId(user);

    const qb = this.tripRepository
      .createQueryBuilder('trip')
      .leftJoinAndSelect('trip.order', 'order')
      .where('trip.deletedAt IS NULL');

    if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER && userHubId) {
      qb.andWhere(
        '(order.destinationHubId = :userHubId OR order.destinationHubId IS NULL)',
        { userHubId },
      );
    }

    if (query?.search && query.search.trim()) {
      const rawSearch = query.search.trim();
      const search = `%${rawSearch}%`;
      const numericPart = rawSearch.replace(/\D/g, '');
      const numId = numericPart ? Number(numericPart) : null;

      if (rawSearch.toUpperCase() === 'TRIP') {
        // Matches all trips since all codes are formatted TRIP-{id}
      } else if (numId) {
        qb.andWhere(
          '(trip.id = :numId OR trip.licensePlate ILIKE :search OR trip.driverName ILIKE :search)',
          { numId, search },
        );
      } else {
        qb.andWhere(
          '(trip.licensePlate ILIKE :search OR trip.driverName ILIKE :search OR trip.status ILIKE :search)',
          { search },
        );
      }
    }

    qb.orderBy('trip.createdAt', 'DESC');

    const [trips, total] = await qb.skip(skip).take(limit).getManyAndCount();

    const formatted = trips.map((t) => ({
      id: t.id,
      tripCode: `TRIP-${t.id}`,
      vehicleLicensePlate: t.licensePlate || '',
      driverName: t.driverName || '',
      status: t.status || 'PENDING',
      originHub: t.order?.originHub || '',
      destinationHub: t.order?.destinationHub || '',
      remainingOrdersCount: t.order ? 1 : 0,
      totalWeight: Number(t.weightAllocated ?? t.order?.totalWeight ?? 0),
      totalVolume: Number(t.volumeAllocated ?? t.order?.totalVolume ?? 0),
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
