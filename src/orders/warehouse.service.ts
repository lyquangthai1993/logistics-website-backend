import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, EntityManager } from 'typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { HubEntity } from '../hubs/infrastructure/persistence/relational/entities/hub.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { TripEntity } from '../trips/infrastructure/persistence/relational/entities/trip.entity';
import {
  OrderInventoryTransactionEntity,
  InventoryTransactionType,
} from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { OrderCodeService } from './order-code.service';
import { RoleEnum } from '../roles/roles.enum';
import {
  QuickCreateInboundOrderDto,
  BatchQuickCreateInboundDto,
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
    @InjectRepository(OrderInventoryTransactionEntity)
    private readonly transactionRepository: Repository<OrderInventoryTransactionEntity>,
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
      .leftJoinAndSelect('order.inventoryTransactions', 'inventoryTransactions')
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
      countQb.leftJoin('order.trips', 'trips');
      countQb.andWhere(
        '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search OR trips.licensePlate ILIKE :search)',
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

    // Freetext Search: orderCode OR goodsDescription OR trips.licensePlate
    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search OR trips.licensePlate ILIKE :search)',
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
   * Generate canonical Trip Code: TRIP-{YYMM}-{SEQUENCE}
   */
  async generateTripCode(manager?: EntityManager): Promise<string> {
    const yymm = this.orderCodeService.getYearMonthPeriod(); // e.g. "2609"
    const repo = manager ? manager.getRepository(TripEntity) : this.tripRepository;

    const result = await repo
      .createQueryBuilder('trip')
      .select('MAX(trip.tripCode)', 'maxCode')
      .where('trip.tripCode LIKE :pattern', { pattern: `TRIP-${yymm}-%` })
      .getRawOne();

    let nextSeq = 1;
    if (result?.maxCode) {
      const parts = result.maxCode.split('-');
      const currentSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(currentSeq)) {
        nextSeq = currentSeq + 1;
      }
    }

    const paddedSeq = String(nextSeq).padStart(3, '0');
    return `TRIP-${yymm}-${paddedSeq}`;
  }

  /**
   * Quick create inbound order row from warehouse.
   * Generates code atomically via OrderCodeService, sets status = 'INBOUND' (LƯU KHO).
   * Automatically creates TripEntity with tripCode, licensePlate, and driverName.
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
      !finalOrderCode ||
      finalOrderCode === '(Tự sinh khi lưu)' ||
      finalOrderCode.startsWith('(Tự sinh')
    ) {
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

    const finalGoodsDescription =
      dto.goodsDescription?.trim() ||
      (initialStatus === 'DRAFT' ? 'Hàng lưu kho (Nháp)' : 'Hàng hóa');

    const finalQuantity =
      dto.totalQuantity !== undefined && Number(dto.totalQuantity) > 0
        ? Number(dto.totalQuantity)
        : 1;

    const finalWeight =
      dto.totalWeight !== undefined && Number(dto.totalWeight) >= 0
        ? Number(dto.totalWeight)
        : 0;

    const finalVolume =
      dto.totalVolume !== undefined && Number(dto.totalVolume) >= 0
        ? Number(dto.totalVolume)
        : 0;

    const plate = dto.licensePlate?.trim().toUpperCase();
    const driver = dto.driverName?.trim() || null;
    const date = dto.receiveDate?.trim() || new Date().toISOString().split('T')[0];

    const order = this.orderRepository.create({
      orderCode: finalOrderCode,
      goodsDescription: finalGoodsDescription,
      totalQuantity: finalQuantity,
      inboundQuantity: finalQuantity,
      outboundQuantity: 0,
      remainingQuantity: finalQuantity,
      totalWeight: finalWeight,
      totalVolume: finalVolume,
      route: `${originHubName || 'Hub'} → ${dto.deliveryAddress || destinationHubName || 'Điểm đến'}`,
      originHub: originHubName,
      originHubId,
      destinationHub: destinationHubName,
      destinationHubId: dto.destinationHubId || null,
      province: dto.province?.trim() || null,
      notes: dto.notes?.trim() || null,
      status: initialStatus,
      createdByUserId: user.id,
      isExternalVehicleNeeded: false,
    });

    const savedOrder = await this.orderRepository.save(order);

    // Record initial INBOUND inventory transaction
    await this.transactionRepository.save(
      this.transactionRepository.create({
        orderId: savedOrder.id,
        type: InventoryTransactionType.INBOUND,
        quantity: finalQuantity,
        remainingQuantity: finalQuantity,
        weight: finalWeight,
        volume: finalVolume,
        licensePlate: plate || null,
        driverName: driver || null,
        notes: dto.notes?.trim() || 'Tiếp nhận nhập kho ban đầu',
        destination: dto.deliveryAddress || destinationHubName || null,
        performedByUserId: user.id,
      }),
    );

    // Create TripEntity for vehicle intake
    if (plate) {
      let finalTripCode = dto.tripCode?.trim();
      if (!finalTripCode) {
        finalTripCode = await this.generateTripCode();
      }

      const trip = this.tripRepository.create({
        orderId: savedOrder.id,
        tripCode: finalTripCode,
        licensePlate: plate,
        driverName: driver,
        status: 'COMPLETED',
        pickupDate: date,
        weightAllocated: finalWeight,
        volumeAllocated: finalVolume,
        notes: `[NHẬP KHO] Xe ${plate} tiếp nhận ${finalQuantity} kiện tại ${originHubName || 'Kho'}`,
      });
      await this.tripRepository.save(trip);
      savedOrder.trips = [trip];
    }

    return savedOrder;
  }

  /**
   * Batch create inbound orders for a single vehicle trip.
   * Generates ONE shared canonical tripCode, creates OrderEntity and TripEntity for each item.
   */
  async batchCreateInboundOrders(
    user: UserEntity,
    dto: BatchQuickCreateInboundDto,
  ): Promise<{
    tripCode: string;
    licensePlate: string;
    driverName: string | null;
    count: number;
    orders: OrderEntity[];
  }> {
    if (!dto.items || dto.items.length === 0) {
      throw new UnprocessableEntityException('Danh sách hàng nhập kho không được để trống');
    }

    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });

    if (!userWithHub) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại trên hệ thống hoặc phiên đăng nhập đã cũ. Vui lòng đăng nhập lại.',
      );
    }

    const plate = dto.licensePlate.trim().toUpperCase();
    const driver = dto.driverName?.trim() || null;
    const date = dto.receiveDate?.trim() || new Date().toISOString().split('T')[0];

    // Single shared tripCode for all items on this vehicle
    let sharedTripCode = dto.tripCode?.trim();
    if (!sharedTripCode) {
      sharedTripCode = await this.generateTripCode();
    }

    const savedOrders: OrderEntity[] = [];

    // Execute in transaction for atomicity
    await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      const originHubId = userWithHub.hubId || null;
      const originHubName = userWithHub.hub?.name || null;

      for (const item of dto.items) {
        let finalOrderCode = item.orderCode?.trim();
        if (
          !finalOrderCode ||
          finalOrderCode === '(Tự sinh khi lưu)' ||
          finalOrderCode.startsWith('(Tự sinh')
        ) {
          finalOrderCode = await this.orderCodeService.generateOrderCode(userWithHub, manager);
        }

        let destinationHubName: string | null = null;
        if (item.destinationHubId) {
          const destHub = await hubRepo.findOne({
            where: { id: item.destinationHubId },
          });
          if (destHub) {
            destinationHubName = destHub.name;
          }
        }

        const initialStatus = item.initialStatus || 'INBOUND';
        const finalGoodsDesc =
          item.goodsDescription?.trim() ||
          (initialStatus === 'DRAFT' ? 'Hàng lưu kho (Nháp)' : 'Hàng hóa');
        const qty =
          item.totalQuantity !== undefined && Number(item.totalQuantity) > 0
            ? Number(item.totalQuantity)
            : 1;
        const weight =
          item.totalWeight !== undefined && Number(item.totalWeight) >= 0
            ? Number(item.totalWeight)
            : 0;
        const vol =
          item.totalVolume !== undefined && Number(item.totalVolume) >= 0
            ? Number(item.totalVolume)
            : 0;

        const order = orderRepo.create({
          orderCode: finalOrderCode,
          goodsDescription: finalGoodsDesc,
          totalQuantity: qty,
          inboundQuantity: qty,
          outboundQuantity: 0,
          remainingQuantity: qty,
          totalWeight: weight,
          totalVolume: vol,
          route: `${originHubName || 'Hub'} → ${item.deliveryAddress || destinationHubName || 'Điểm đến'}`,
          originHub: originHubName,
          originHubId,
          destinationHub: destinationHubName,
          destinationHubId: item.destinationHubId || null,
          province: item.province?.trim() || null,
          notes: item.notes?.trim() || null,
          status: initialStatus,
          createdByUserId: user.id,
          isExternalVehicleNeeded: false,
        });

        const savedOrder = await orderRepo.save(order);

        // Create TripEntity linked to this order with shared tripCode
        const trip = tripRepo.create({
          orderId: savedOrder.id,
          tripCode: sharedTripCode,
          licensePlate: plate,
          driverName: driver,
          status: 'COMPLETED',
          pickupDate: date,
          weightAllocated: weight,
          volumeAllocated: vol,
          notes: `[NHẬP KHO] Xe ${plate} tiếp nhận ${qty} kiện tại ${originHubName || 'Kho'}`,
        });
        await tripRepo.save(trip);
        savedOrder.trips = [trip];

        // Create initial INBOUND inventory transaction
        await txRepo.save(
          txRepo.create({
            orderId: savedOrder.id,
            type: InventoryTransactionType.INBOUND,
            quantity: qty,
            remainingQuantity: qty,
            weight: weight,
            volume: vol,
            licensePlate: plate,
            driverName: driver,
            notes: item.notes?.trim() || `Tiếp nhận xe ${plate} - ${sharedTripCode}`,
            destination: item.deliveryAddress || destinationHubName || null,
            performedByUserId: user.id,
          }),
        );

        savedOrders.push(savedOrder);
      }
    });

    return {
      tripCode: sharedTripCode,
      licensePlate: plate,
      driverName: driver,
      count: savedOrders.length,
      orders: savedOrders,
    };
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
          if (!hasSpecificCode || !newOrderCode) {
            newOrderCode = userWithHub
              ? await this.orderCodeService.generateOrderCode(userWithHub)
              : `ORD-${Date.now()}`;
          }

          const initQty = Number(row.totalQuantity) || 1;
          const newOrder = this.orderRepository.create({
            orderCode: newOrderCode,
            goodsDescription: (row.goodsDescription || 'Hàng gom luân chuyển').trim(),
            totalQuantity: initQty,
            inboundQuantity: initQty,
            outboundQuantity: 0,
            remainingQuantity: initQty,
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

    // 4. Record inbound vehicle trip if license plate was provided
    const inboundPlate = (body?.vehicleLicensePlate || body?.licensePlate || '')?.trim();
    const inboundDriver = (body?.driverName || '')?.trim();
    if (inboundPlate && savedOrders.length > 0) {
      for (const order of savedOrders) {
        const trip = this.tripRepository.create({
          orderId: order.id,
          licensePlate: inboundPlate,
          driverName: inboundDriver || null,
          status: 'COMPLETED',
          pickupDate: new Date().toISOString().split('T')[0],
          weightAllocated: Number(order.totalWeight) || 0,
          volumeAllocated: Number(order.totalVolume) || 0,
          notes: `[NHẬP KHO] Xe nhập ${order.inboundQuantity || order.totalQuantity} kiện tại ${userWithHub?.hub?.name || 'Kho'}`,
        });
        await this.tripRepository.save(trip);
      }
    }

    // 5. Record INBOUND inventory transactions for all confirmed orders
    for (const order of savedOrders) {
      await this.transactionRepository.save(
        this.transactionRepository.create({
          orderId: order.id,
          type: InventoryTransactionType.INBOUND,
          quantity: order.inboundQuantity || order.totalQuantity || 1,
          remainingQuantity: order.remainingQuantity ?? order.totalQuantity ?? 1,
          weight: Number(order.totalWeight) || 0,
          volume: Number(order.totalVolume) || 0,
          licensePlate: inboundPlate || null,
          driverName: inboundDriver || null,
          destination: order.destinationHub || order.province || null,
          performedByUserId: user.id,
          notes: inboundPlate
            ? `Nhập kho từ xe ${inboundPlate} tại ${userWithHub?.hub?.name || 'Kho'}`
            : `Tiếp nhận lưu kho tại ${userWithHub?.hub?.name || 'Kho'}`,
        }),
      );
    }

    return {
      updatedCount: savedOrders.length - newCreatedCount,
      newCount: newCreatedCount,
      orders: savedOrders,
    };
  }

  /**
   * Confirm outbound dispatch (Customer vs Transfer).
   * Supports partial export deductions and validates against available inventory.
   */
  async confirmOutbound(
    user: UserEntity,
    dto: ConfirmOutboundDto,
  ): Promise<{ updatedCount: number; orders: OrderEntity[]; trip?: TripEntity }> {
    const targetOrderIds =
      dto.items && dto.items.length > 0
        ? dto.items.map((i) => i.orderId)
        : dto.orderIds || [];

    if (!targetOrderIds || targetOrderIds.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
    }

    const orders = await this.orderRepository.find({
      where: { id: In(targetOrderIds) },
    });

    if (orders.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
    }

    const isTransfer = dto.mode === OutboundMode.TRANSFER;
    let destHubName = '';
    if (isTransfer && dto.destinationHubId) {
      const destHub = await this.hubRepository.findOne({
        where: { id: dto.destinationHubId },
      });
      if (destHub) {
        destHubName = destHub.name;
      }
    }

    let createdTrip: TripEntity | undefined;

    for (const order of orders) {
      const item = dto.items?.find((i) => i.orderId === order.id);
      const availableQty =
        order.remainingQuantity !== undefined && order.remainingQuantity !== null
          ? order.remainingQuantity
          : (order.totalQuantity || 0);

      const qtyToExport =
        item && item.quantityToExport !== undefined
          ? Number(item.quantityToExport)
          : availableQty;

      if (qtyToExport <= 0) {
        throw new UnprocessableEntityException(
          `Đơn hàng ${order.orderCode}: Số lượng xuất phải lớn hơn 0.`,
        );
      }

      if (qtyToExport > availableQty) {
        throw new UnprocessableEntityException(
          `Mã đơn ${order.orderCode}: Số lượng xuất (${qtyToExport}) vượt quá tồn kho khả dụng (${availableQty} kiện).`,
        );
      }

      order.outboundQuantity = (order.outboundQuantity || 0) + qtyToExport;
      order.remainingQuantity = Math.max(0, availableQty - qtyToExport);

      if (order.remainingQuantity === 0) {
        order.status = 'COMPLETED_INBOUND'; // ĐÃ XUẤT KHO toàn bộ
      } else {
        order.status = 'INBOUND'; // Còn tồn kho, giữ LƯU KHO để xuất đợt tiếp theo
      }

      if (isTransfer && dto.destinationHubId) {
        order.destinationHubId = dto.destinationHubId;
      }

      const tripNotes = isTransfer
        ? `[XUẤT KHO - LUÂN CHUYỂN] Xuất ${qtyToExport} kiện đến ${destHubName || 'Kho đích'}`
        : `[XUẤT KHO - GIAO KHÁCH] Xuất ${qtyToExport} kiện giao khách`;

      const trip = this.tripRepository.create({
        orderId: order.id,
        licensePlate: dto.licensePlate || 'Xe xuất kho',
        driverName: dto.driverName || 'Tài xế giao hàng',
        status: 'IN_TRANSIT',
        pickupDate: (dto as any).dispatchDate || new Date().toISOString().split('T')[0],
        weightAllocated: Number(item?.weightToExport ?? order.totalWeight ?? 0),
        volumeAllocated: Number(item?.volumeToExport ?? order.totalVolume ?? 0),
        notes: tripNotes,
      });
      createdTrip = await this.tripRepository.save(trip);

      // Record OUTBOUND / TRANSFER inventory transaction
      await this.transactionRepository.save(
        this.transactionRepository.create({
          orderId: order.id,
          type: isTransfer
            ? InventoryTransactionType.TRANSFER
            : InventoryTransactionType.OUTBOUND,
          quantity: qtyToExport,
          remainingQuantity: order.remainingQuantity,
          weight: Number(item?.weightToExport ?? 0),
          volume: Number(item?.volumeToExport ?? 0),
          licensePlate: dto.licensePlate || null,
          driverName: dto.driverName || null,
          destination: isTransfer
            ? destHubName || 'Kho đích'
            : (order.destinationHub || order.province || 'Giao khách'),
          performedByUserId: user.id,
          notes: isTransfer
            ? `Xuất ${qtyToExport} kiện luân chuyển đến ${destHubName || 'Kho đích'}`
            : `Xuất ${qtyToExport} kiện giao khách`,
        }),
      );
    }

    const saved = await this.orderRepository.save(orders);

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
