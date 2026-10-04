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
  TripStopStatus,
  TripStopType,
} from '../trips/infrastructure/persistence/relational/entities/trip-stop.entity';
import {
  OrderInventoryTransactionEntity,
  InventoryTransactionType,
} from './infrastructure/persistence/relational/entities/order-inventory-transaction.entity';
import { OrderCodeService } from './order-code.service';
import {
  DRAFT_LIKE_STATUSES,
  OperationalLedgerService,
} from './operational-ledger.service';
import { RoleEnum } from '../roles/roles.enum';
import {
  QuickCreateInboundOrderDto,
  BatchQuickCreateInboundDto,
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

/** Status groups used by warehouse tabs & KPI cards (values of the hub-scoped status). */
const WAITING_STATUSES = ['DRAFT', 'PENDING', 'PENDING_INBOUND', 'WAITING'];
const STORED_STATUSES = ['INBOUND', 'STORED', 'LUU_KHO', 'IN_WAREHOUSE'];
const DISPATCHED_STATUSES = [
  'COMPLETED_INBOUND',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED_OUTBOUND',
];

const sqlList = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

/** Inbound classification: inter-hub order or already linked to a trip. */
const TRANSFER_INBOUND_SQL = `(((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub)) OR EXISTS (SELECT 1 FROM trip t WHERE t."orderId" = order.id AND t."deletedAt" IS NULL))`;
/** Outbound classification: inter-hub order. */
const TRANSFER_OUTBOUND_SQL = `((order.originHubId IS NOT NULL AND order.destinationHubId IS NOT NULL AND order.originHubId != order.destinationHubId) OR (order.originHub IS NOT NULL AND order.destinationHub IS NOT NULL AND order.originHub != order.destinationHub))`;

const isPlaceholderCode = (code?: string | null) =>
  !code || code === '(Tự sinh khi lưu)' || code.startsWith('(Tự sinh');

const normalizeTripCode = (code?: string | null) => {
  const c = (code || '').trim();
  return c && c !== '—' ? c : '';
};

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
    private readonly ledgerService: OperationalLedgerService,
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

  /** Hub-scoped status context applies to Warehouse Managers assigned to a hub. */
  private async resolveHubContext(
    user: UserEntity,
  ): Promise<{ userHubId: number | null; useHubContext: boolean }> {
    const userHubId = (await this.resolveUserHubId(user)) ?? null;
    const useHubContext =
      user.role?.id === RoleEnum.WAREHOUSE_MANAGER && !!userHubId;
    return { userHubId, useHubContext };
  }

  /** Proportional share of a contract metric for a partial quantity. */
  private proportional(total: number | null | undefined, qty: number, totalQty: number | null | undefined): number {
    const t = Number(total) || 0;
    const tq = Number(totalQty) || 0;
    if (!tq || qty >= tq) return t;
    return Math.round(((t * qty) / tq) * 1000) / 1000;
  }

  /**
   * Hub-scoped status & stock for a set of orders as seen by a hub.
   */
  private async computeHubView(
    orderIds: number[],
    hubId: number,
  ): Promise<Map<number, { hubStatus: string; hubStock: number }>> {
    const map = new Map<number, { hubStatus: string; hubStock: number }>();
    if (orderIds.length === 0) return map;
    const rows = await this.orderRepository
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect(this.ledgerService.hubStatusSql(), 'hubStatus')
      .addSelect(this.ledgerService.hubStockSql(), 'hubStock')
      .where('order.id IN (:...orderIds)', { orderIds })
      .setParameter('userHubId', hubId)
      .getRawMany();
    for (const r of rows) {
      map.set(Number(r.id), {
        hubStatus: r.hubStatus,
        hubStock: Number(r.hubStock) || 0,
      });
    }
    return map;
  }

  /**
   * List or Lookup warehouse orders with Freetext Search, Status Filter & Pagination.
   * Strict Hub Scoping for WAREHOUSE_MANAGER; statuses are resolved from the manager's hub
   * perspective (Context-Aware status: Chờ nhập kho / Lưu kho / Đã xuất kho).
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

    const { userHubId, useHubContext } = await this.resolveHubContext(user);
    const statusExpr = useHubContext
      ? this.ledgerService.hubStatusSql()
      : 'order.status';

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
      .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
      .leftJoinAndSelect('order.currentHubEntity', 'currentHubEntity')
      .leftJoinAndSelect('order.trips', 'trips')
      .leftJoinAndSelect('order.inventoryTransactions', 'inventoryTransactions')
      .where('order.deletedAt IS NULL');

    // Dynamic counts for status tabs based on current hub scope
    const countQb = this.orderRepository
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect(statusExpr, 'hs')
      .distinct(true)
      .where('order.deletedAt IS NULL');

    if (useHubContext) {
      const scope = this.ledgerService.hubScopeSql();
      qb.andWhere(scope).setParameter('userHubId', userHubId);
      countQb.andWhere(scope).setParameter('userHubId', userHubId);
    }

    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      countQb.leftJoin('order.trips', 'trips');
      countQb.andWhere(
        '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search OR trips.licensePlate ILIKE :search OR trips.tripCode ILIKE :search)',
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

    const countRows = await countQb.getRawMany();
    const allCount = countRows.length;
    const storedCount = countRows.filter((r) => STORED_STATUSES.includes(r.hs)).length;
    const draftCount = countRows.filter((r) => WAITING_STATUSES.includes(r.hs)).length;

    // Status Filter (Standard Uppercase Enum Keys) — applied on the hub-scoped status
    if (query?.status && query.status.toUpperCase() !== 'ALL') {
      const statusUpper = query.status.toUpperCase();
      const waitingOrStored = sqlList([...WAITING_STATUSES, ...STORED_STATUSES]);
      switch (statusUpper) {
        case 'INBOUND':
        case 'STORED':
        case 'IN_WAREHOUSE':
          qb.andWhere(`${statusExpr} IN (${sqlList(STORED_STATUSES)})`);
          break;
        case 'WAITING':
        case 'DRAFT':
          qb.andWhere(`${statusExpr} IN (${sqlList(WAITING_STATUSES)})`);
          break;
        case 'CUSTOMER':
          qb.andWhere(
            `${statusExpr} IN (${waitingOrStored}) AND NOT ${TRANSFER_INBOUND_SQL}`,
          );
          break;
        case 'TRANSFER':
          qb.andWhere(`${statusExpr} IN (${waitingOrStored}) AND ${TRANSFER_INBOUND_SQL}`);
          break;
        case 'COMPLETED_INBOUND':
          qb.andWhere(`${statusExpr} IN (${sqlList(DISPATCHED_STATUSES)})`);
          break;
        case 'PENDING_INBOUND':
          qb.andWhere(`${statusExpr} IN ('PENDING_INBOUND', 'WAITING')`);
          break;
        default:
          qb.andWhere(`${statusExpr} = :st`, { st: query.status });
          break;
      }
    }

    // Freetext Search: orderCode OR goodsDescription OR trips.licensePlate OR trips.tripCode
    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(order.orderCode ILIKE :search OR order.goodsDescription ILIKE :search OR trips.licensePlate ILIKE :search OR trips.tripCode ILIKE :search)',
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

    const hubView =
      useHubContext && userHubId
        ? await this.computeHubView(
            data.map((d) => d.id),
            userHubId,
          )
        : new Map<number, { hubStatus: string; hubStock: number }>();

    const enrichedData = data.map((item) => {
      let pickupAddr = item.originHub || '';
      let deliveryAddr = '';
      if (item.route && item.route.includes('→')) {
        const parts = item.route.split('→');
        if (!pickupAddr || pickupAddr === 'Hub') {
          pickupAddr = parts[0]?.trim() || '';
        }
        deliveryAddr = parts[1]?.trim() || '';
      }
      const view = hubView.get(item.id);
      return {
        ...item,
        pickupAddress: pickupAddr || item.originHubEntity?.name || '',
        deliveryAddress: deliveryAddr || item.destinationHub || item.destinationHubEntity?.name || '',
        /** Status seen from the viewer's hub (falls back to global status). */
        hubStatus: view?.hubStatus ?? item.status,
        /** Available stock at the viewer's hub (ledger based); null without hub context. */
        hubStock: view ? view.hubStock : null,
        isContractLocked: !DRAFT_LIKE_STATUSES.includes(item.status),
      };
    });

    return {
      data: enrichedData as any,
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
   * Allocate the canonical short trip code: SD1, SD2, ... (global sequence `trip_code_sd_seq`).
   */
  async generateTripCode(manager?: EntityManager): Promise<string> {
    return this.ledgerService.generateTripCode(manager);
  }

  private async loadUserWithHub(user: UserEntity): Promise<UserEntity> {
    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    if (!userWithHub) {
      throw new UnauthorizedException(
        'Tài khoản không tồn tại trên hệ thống hoặc phiên đăng nhập đã cũ. Vui lòng đăng nhập lại.',
      );
    }
    return userWithHub;
  }

  /**
   * Quick create inbound order row from warehouse.
   * Generates code atomically via OrderCodeService, sets status = 'INBOUND' (LƯU KHO).
   * Creates the Master Contract + (when not a draft) the first Inbound Receipt invoice.
   * Automatically creates TripEntity with SD trip code, licensePlate, driverName and the hub stop.
   */
  async quickCreateInboundOrder(
    user: UserEntity,
    dto: QuickCreateInboundOrderDto,
  ): Promise<OrderEntity> {
    const userWithHub = await this.loadUserWithHub(user);

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      // Check if client provided custom orderCode
      let finalOrderCode = dto.orderCode?.trim();
      if (isPlaceholderCode(finalOrderCode)) {
        // Server generates canonical orderCode atomically
        finalOrderCode = await this.orderCodeService.generateOrderCode(userWithHub, manager);
      }

      let destinationHubName: string | null = null;
      if (dto.destinationHubId) {
        const destHub = await hubRepo.findOne({
          where: { id: dto.destinationHubId },
        });
        if (destHub) {
          destinationHubName = destHub.name;
        }
      }

      const originHubId = userWithHub.hubId || null;
      const originHubName = userWithHub.hub?.name || null;

      const initialStatus = dto.initialStatus || 'INBOUND'; // LƯU KHO
      const isDraft = DRAFT_LIKE_STATUSES.includes(initialStatus);

      const finalGoodsDescription =
        dto.goodsDescription?.trim() ||
        (isDraft ? 'Hàng lưu kho (Nháp)' : 'Hàng hóa');

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

      const pickupAddr = dto.pickupAddress?.trim() || originHubName || 'Hub';
      const deliveryAddr = dto.deliveryAddress?.trim() || destinationHubName || 'Điểm đến';

      const finalTripCode = plate
        ? normalizeTripCode(dto.tripCode) || (await this.ledgerService.generateTripCode(manager))
        : null;

      const order = orderRepo.create({
        orderCode: finalOrderCode,
        goodsDescription: finalGoodsDescription,
        totalQuantity: finalQuantity,
        inboundQuantity: finalQuantity,
        outboundQuantity: 0,
        remainingQuantity: finalQuantity,
        totalWeight: finalWeight,
        totalVolume: finalVolume,
        route: `${pickupAddr} → ${deliveryAddr}`,
        originHub: dto.pickupAddress?.trim() || originHubName,
        originHubId,
        currentHubId: originHubId,
        destinationHub: destinationHubName,
        destinationHubId: dto.destinationHubId || null,
        province: dto.province?.trim() || null,
        accompanyingDocs: dto.accompanyingDocs?.trim() || null,
        notes: dto.notes?.trim() || null,
        status: initialStatus,
        createdByUserId: user.id,
        isExternalVehicleNeeded: false,
      });

      const savedOrder = await orderRepo.save(order);

      // Create TripEntity for vehicle intake
      let savedTrip: TripEntity | null = null;
      if (plate && finalTripCode) {
        savedTrip = await tripRepo.save(
          tripRepo.create({
            orderId: savedOrder.id,
            tripCode: finalTripCode,
            licensePlate: plate,
            driverName: driver,
            status: isDraft ? 'PENDING' : 'COMPLETED',
            pickupDate: date,
            weightAllocated: finalWeight,
            volumeAllocated: finalVolume,
            notes: `[NHẬP KHO] Xe ${plate} tiếp nhận ${finalQuantity} kiện tại ${originHubName || 'Kho'}`,
          }),
        );
        savedOrder.trips = [savedTrip];

        if (originHubId) {
          await this.ledgerService.upsertTripStop(
            {
              tripCode: finalTripCode,
              hubId: originHubId,
              status: isDraft ? TripStopStatus.PENDING : TripStopStatus.COMPLETED,
              stopType: TripStopType.DESTINATION,
              stopSequence: 1,
              userId: user.id,
            },
            manager,
          );
        }
      }

      // Initial Inbound Receipt invoice — drafts are not in stock yet.
      if (!isDraft) {
        const invoiceCode = await this.ledgerService.generateInvoiceCode(
          InventoryTransactionType.INBOUND,
          originHubId,
          manager,
        );
        await txRepo.save(
          txRepo.create({
            orderId: savedOrder.id,
            type: InventoryTransactionType.INBOUND,
            invoiceCode,
            hubId: originHubId,
            tripId: savedTrip?.id ?? null,
            tripCode: finalTripCode,
            quantity: finalQuantity,
            expectedQuantity: finalQuantity,
            discrepancyQuantity: 0,
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
      }

      return savedOrder;
    });
  }

  /**
   * Batch create inbound orders for a single vehicle trip.
   * Generates ONE shared SD trip code, creates OrderEntity and TripEntity for each item,
   * one shared Inbound Receipt invoice code and the hub stop.
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
    invoiceCode?: string | null;
  }> {
    if (!dto.items || dto.items.length === 0) {
      throw new UnprocessableEntityException('Danh sách hàng nhập kho không được để trống');
    }

    const userWithHub = await this.loadUserWithHub(user);

    const plate = dto.licensePlate.trim().toUpperCase();
    const driver = dto.driverName?.trim() || null;
    const date = dto.receiveDate?.trim() || new Date().toISOString().split('T')[0];

    const savedOrders: OrderEntity[] = [];
    let sharedTripCode = '';
    let invoiceCode: string | null = null;

    // Execute in transaction for atomicity
    await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      const originHubId = userWithHub.hubId || null;
      const originHubName = userWithHub.hub?.name || null;

      // Single shared tripCode for all items on this vehicle
      sharedTripCode =
        normalizeTripCode(dto.tripCode) ||
        (await this.ledgerService.generateTripCode(manager));

      const allDraft = dto.items.every((i) =>
        DRAFT_LIKE_STATUSES.includes(i.initialStatus || 'INBOUND'),
      );

      for (const item of dto.items) {
        let finalOrderCode = item.orderCode?.trim();
        if (isPlaceholderCode(finalOrderCode)) {
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
        const isDraft = DRAFT_LIKE_STATUSES.includes(initialStatus);
        const finalGoodsDesc =
          item.goodsDescription?.trim() ||
          (isDraft ? 'Hàng lưu kho (Nháp)' : 'Hàng hóa');
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

        const pickupAddr = item.pickupAddress?.trim() || originHubName || 'Hub';
        const deliveryAddr = item.deliveryAddress?.trim() || destinationHubName || 'Điểm đến';

        const order = orderRepo.create({
          orderCode: finalOrderCode,
          goodsDescription: finalGoodsDesc,
          totalQuantity: qty,
          inboundQuantity: qty,
          outboundQuantity: 0,
          remainingQuantity: qty,
          totalWeight: weight,
          totalVolume: vol,
          route: `${pickupAddr} → ${deliveryAddr}`,
          originHub: item.pickupAddress?.trim() || originHubName,
          originHubId,
          currentHubId: originHubId,
          destinationHub: destinationHubName,
          destinationHubId: item.destinationHubId || null,
          province: item.province?.trim() || null,
          accompanyingDocs: item.accompanyingDocs?.trim() || null,
          notes: item.notes?.trim() || null,
          status: initialStatus,
          createdByUserId: user.id,
          isExternalVehicleNeeded: false,
        });

        const savedOrder = await orderRepo.save(order);

        // Create TripEntity linked to this order with shared tripCode
        const trip = await tripRepo.save(
          tripRepo.create({
            orderId: savedOrder.id,
            tripCode: sharedTripCode,
            licensePlate: plate,
            driverName: driver,
            status: isDraft ? 'PENDING' : 'COMPLETED',
            pickupDate: date,
            weightAllocated: weight,
            volumeAllocated: vol,
            notes: `[NHẬP KHO] Xe ${plate} tiếp nhận ${qty} kiện tại ${originHubName || 'Kho'}`,
          }),
        );
        savedOrder.trips = [trip];

        // Inbound Receipt invoice (one shared receipt code for the whole vehicle)
        if (!isDraft) {
          if (!invoiceCode) {
            invoiceCode = await this.ledgerService.generateInvoiceCode(
              InventoryTransactionType.INBOUND,
              originHubId,
              manager,
            );
          }
          await txRepo.save(
            txRepo.create({
              orderId: savedOrder.id,
              type: InventoryTransactionType.INBOUND,
              invoiceCode,
              hubId: originHubId,
              tripId: trip.id,
              tripCode: sharedTripCode,
              quantity: qty,
              expectedQuantity: qty,
              discrepancyQuantity: 0,
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
        }

        savedOrders.push(savedOrder);
      }

      if (originHubId) {
        await this.ledgerService.upsertTripStop(
          {
            tripCode: sharedTripCode,
            hubId: originHubId,
            status: allDraft ? TripStopStatus.PENDING : TripStopStatus.COMPLETED,
            stopType: TripStopType.DESTINATION,
            stopSequence: 1,
            userId: user.id,
          },
          manager,
        );
      }
    });

    return {
      tripCode: sharedTripCode,
      licensePlate: plate,
      driverName: driver,
      count: savedOrders.length,
      orders: savedOrders,
      invoiceCode,
    };
  }

  /**
   * Confirm inbound orders at the current hub (Selective Inbound Tally).
   *
   * Master Contract rules:
   *  - DRAFT orders of this hub: contract fields may still be edited, then the order enters stock.
   *  - Locked orders (left DRAFT / coming from another hub): contract fields are NEVER modified.
   *    An Inbound Receipt invoice records the actual counted quantity and any discrepancy
   *    against the quantity expected from the trip.
   *  - Rows not sent by the client (skipped / kept on the truck) are untouched.
   *  - The trip stop of the current hub becomes COMPLETED (Đã xử lý); other hubs keep their own status.
   */
  async confirmInbound(
    user: UserEntity,
    body: any,
  ): Promise<{
    updatedCount: number;
    newCount?: number;
    orders: OrderEntity[];
    invoiceCode?: string | null;
    tripCode?: string | null;
  }> {
    let rows: any[] = [];
    let tripId: number | undefined;

    if (Array.isArray(body)) {
      rows = body.map((id: number) => ({ id }));
    } else if (body?.orderIds && Array.isArray(body.orderIds)) {
      rows = body.orderIds.map((id: number) => ({ id }));
    } else if (body?.orders && Array.isArray(body.orders)) {
      rows = body.orders;
      tripId = body.tripId;
    } else {
      throw new UnprocessableEntityException('Dữ liệu tiếp nhận kho không hợp lệ');
    }

    if (rows.length === 0) {
      throw new UnprocessableEntityException('Vui lòng chọn ít nhất 1 dòng hàng để tiếp nhận');
    }

    const userWithHub = await this.userRepository.findOne({
      where: { id: user.id },
      relations: ['hub', 'role'],
    });
    const hubId = userWithHub?.hubId ?? null;
    const hubName = userWithHub?.hub?.name || 'Kho';
    const isSuperAdmin = (userWithHub?.role?.id ?? user.role?.id) === RoleEnum.SUPER_ADMIN;

    const targetStatus = body?.targetStatus || 'INBOUND';
    const isKeepStatus = targetStatus === 'KEEP';
    const inboundPlate = (body?.vehicleLicensePlate || body?.licensePlate || '')
      ?.trim()
      .toUpperCase();
    const inboundDriver = (body?.driverName || '')?.trim();
    const inboundDate = body?.receiveDate || new Date().toISOString().split('T')[0];

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);

      let sharedTripCode = normalizeTripCode(body?.tripCode);
      if (!sharedTripCode && tripId) {
        const trip = await tripRepo.findOne({ where: { id: tripId } });
        sharedTripCode = normalizeTripCode(trip?.tripCode);
      }

      const savedOrders: OrderEntity[] = [];
      const processedTripCodes = new Set<string>();
      let newCreatedCount = 0;
      let invoiceCode: string | null = null;

      const ensureInvoiceCode = async () => {
        if (!invoiceCode) {
          invoiceCode = await this.ledgerService.generateInvoiceCode(
            InventoryTransactionType.INBOUND,
            hubId,
            manager,
          );
        }
        return invoiceCode;
      };

      const ensureTripCodeForPlate = async () => {
        if (!sharedTripCode && inboundPlate) {
          sharedTripCode = await this.ledgerService.generateTripCode(manager);
        }
        return sharedTripCode;
      };

      for (const row of rows) {
        const hasSpecificCode = !isPlaceholderCode(row.orderCode);

        let found: OrderEntity | null = null;
        if (row.id) {
          found = await orderRepo.findOne({ where: { id: Number(row.id) } });
        }
        if (!found && hasSpecificCode) {
          found = await orderRepo.findOne({
            where: { orderCode: String(row.orderCode).trim() },
          });
        }

        let actualQty = 0;
        let expectedQty: number | null = null;
        let rowTripCode = sharedTripCode;
        let discrepancyReason: string | null = null;
        let actualWeight = 0;
        let actualVolume = 0;
        let order: OrderEntity;

        if (found) {
          const isEditableDraft =
            DRAFT_LIKE_STATUSES.includes(found.status) &&
            (!found.originHubId || found.originHubId === hubId || isSuperAdmin);

          if (isEditableDraft) {
            // ── Draft of this hub: contract still editable ──
            if (row.totalQuantity !== undefined && Number(row.totalQuantity) > 0) {
              found.totalQuantity = Number(row.totalQuantity);
            }
            if (row.totalWeight !== undefined && Number(row.totalWeight) >= 0) {
              found.totalWeight = Number(row.totalWeight);
            }
            if (row.totalVolume !== undefined && Number(row.totalVolume) >= 0) {
              found.totalVolume = Number(row.totalVolume);
            }
            if (row.goodsDescription) {
              found.goodsDescription = String(row.goodsDescription).trim();
            }
            if (row.deliveryAddress || row.pickupAddress) {
              const currentOrigin = row.pickupAddress?.trim() || found.originHub || hubName || 'Hub';
              const currentDelivery =
                row.deliveryAddress?.trim() ||
                (found.route?.includes('→') ? found.route.split('→')[1]?.trim() : '') ||
                'Điểm đến';
              found.route = `${currentOrigin} → ${currentDelivery}`;
            }
            if (row.pickupAddress) {
              found.originHub = String(row.pickupAddress).trim();
            }
            if (!found.originHubId && hubId) {
              found.originHubId = hubId;
              found.originHub = found.originHub || hubName;
            }
            if (row.destinationHubId !== undefined) {
              found.destinationHubId = row.destinationHubId || null;
            }
            if (!isKeepStatus) {
              const q = Number(found.totalQuantity) || 1;
              found.status = 'INBOUND';
              found.inboundQuantity = q;
              found.remainingQuantity = q;
              found.outboundQuantity = 0;
              found.currentHubId = hubId;
              actualQty = q;
              expectedQty = q;
              actualWeight = Number(found.totalWeight) || 0;
              actualVolume = Number(found.totalVolume) || 0;
            }
          } else if (!isKeepStatus) {
            // ── Locked contract: record an Inbound Receipt, never touch contract fields ──
            rowTripCode = sharedTripCode || normalizeTripCode(found.currentTripCode);

            if (rowTripCode && hubId) {
              const already = await txRepo.findOne({
                where: {
                  orderId: found.id,
                  tripCode: rowTripCode,
                  hubId,
                  type: InventoryTransactionType.INBOUND,
                },
              });
              if (already) {
                throw new UnprocessableEntityException(
                  `Đơn ${found.orderCode} đã được nhập kho tại ${hubName} từ chuyến ${rowTripCode} (phiếu ${already.invoiceCode || '#' + already.id}).`,
                );
              }
            }

            let inTransit: number | null = null;
            if (rowTripCode) {
              const t = await this.ledgerService.getInTransitQuantity(found.id, rowTripCode, manager);
              if (t.loaded > 0) inTransit = t.inTransit;
            }
            expectedQty =
              row.expectedQuantity !== undefined && row.expectedQuantity !== null
                ? Number(row.expectedQuantity)
                : inTransit;

            const rawActual = row.actualQuantity ?? row.totalQuantity;
            actualQty =
              rawActual !== undefined && rawActual !== null && rawActual !== ''
                ? Number(rawActual)
                : (expectedQty ?? (Number(found.totalQuantity) || 1));

            if (!Number.isFinite(actualQty) || actualQty <= 0) {
              throw new UnprocessableEntityException(
                `Đơn ${found.orderCode}: Số kiện thực nhận phải lớn hơn 0.`,
              );
            }

            discrepancyReason = row.discrepancyReason?.trim() || null;
            actualWeight =
              row.actualWeight !== undefined
                ? Number(row.actualWeight) || 0
                : this.proportional(found.totalWeight, actualQty, found.totalQuantity);
            actualVolume =
              row.actualVolume !== undefined
                ? Number(row.actualVolume) || 0
                : this.proportional(found.totalVolume, actualQty, found.totalQuantity);

            found.inboundQuantity = (Number(found.inboundQuantity) || 0) + actualQty;
            found.remainingQuantity = (Number(found.remainingQuantity) || 0) + actualQty;
            found.status = 'INBOUND';
            found.currentHubId = hubId;
            if (
              rowTripCode &&
              found.currentTripCode === rowTripCode &&
              inTransit !== null &&
              inTransit - actualQty <= 0
            ) {
              found.currentTripCode = null;
            }
          }

          // Operational (non-contract) fields remain editable
          if (row.province !== undefined) {
            found.province = row.province?.trim() || null;
          }
          if (row.accompanyingDocs !== undefined) {
            found.accompanyingDocs = row.accompanyingDocs?.trim() || null;
          }
          if (row.notes !== undefined && isEditableDraft) {
            found.notes = row.notes?.trim() || null;
          }

          order = await orderRepo.save(found);
        } else {
          // ── New row added en-route: create a new Master Contract ──
          let newOrderCode = row.orderCode?.trim();
          if (!hasSpecificCode || !newOrderCode) {
            newOrderCode = userWithHub
              ? await this.orderCodeService.generateOrderCode(userWithHub, manager)
              : `ORD-${Date.now()}`;
          }

          const initQty = Number(row.totalQuantity) || 1;
          const newOrder = orderRepo.create({
            orderCode: newOrderCode,
            goodsDescription: (row.goodsDescription || 'Hàng gom luân chuyển').trim(),
            totalQuantity: initQty,
            inboundQuantity: initQty,
            outboundQuantity: 0,
            remainingQuantity: initQty,
            totalWeight: Number(row.totalWeight) || 0,
            totalVolume: Number(row.totalVolume) || 0,
            route: `${row.pickupAddress?.trim() || hubName || 'Hub'} → ${row.deliveryAddress || 'Điểm giao'}`,
            originHub: row.pickupAddress?.trim() || userWithHub?.hub?.name || null,
            originHubId: hubId,
            currentHubId: hubId,
            destinationHub: row.destinationHub || null,
            destinationHubId: row.destinationHubId || null,
            province: row.province?.trim() || null,
            accompanyingDocs: row.accompanyingDocs?.trim() || null,
            notes: row.notes?.trim() || 'Hàng tiếp nhận xe nhập kho',
            status: isKeepStatus ? 'DRAFT' : 'INBOUND',
            createdByUserId: user.id,
            isExternalVehicleNeeded: false,
          });

          order = await orderRepo.save(newOrder);
          newCreatedCount++;
          if (!isKeepStatus) {
            actualQty = initQty;
            expectedQty = initQty;
            actualWeight = Number(order.totalWeight) || 0;
            actualVolume = Number(order.totalVolume) || 0;
          }
        }

        savedOrders.push(order);

        // Link the order to the vehicle trip (allocation row) when a plate is provided
        let linkedTripId: number | null = null;
        if (inboundPlate) {
          const code = rowTripCode || (await ensureTripCodeForPlate());
          rowTripCode = code;
          const existingTrip = await tripRepo.findOne({
            where: { orderId: order.id, tripCode: code },
          });
          if (existingTrip) {
            linkedTripId = existingTrip.id;
          } else {
            const createdTrip = await tripRepo.save(
              tripRepo.create({
                orderId: order.id,
                tripCode: code,
                licensePlate: inboundPlate,
                driverName: inboundDriver || null,
                status: isKeepStatus ? 'PENDING' : 'COMPLETED',
                pickupDate: inboundDate,
                weightAllocated: Number(order.totalWeight) || 0,
                volumeAllocated: Number(order.totalVolume) || 0,
                notes: `[NHẬP KHO] Xe nhập ${actualQty || order.totalQuantity} kiện tại ${hubName}`,
              }),
            );
            linkedTripId = createdTrip.id;
          }
        } else if (rowTripCode) {
          const existingTrip = await tripRepo.findOne({
            where: { orderId: order.id, tripCode: rowTripCode },
          });
          linkedTripId = existingTrip?.id ?? null;
        }

        if (rowTripCode) processedTripCodes.add(rowTripCode);

        // Inbound Receipt invoice (one shared receipt code per confirmation)
        if (!isKeepStatus && actualQty > 0) {
          const discrepancy = expectedQty !== null ? actualQty - expectedQty : 0;
          const code = await ensureInvoiceCode();
          await txRepo.save(
            txRepo.create({
              orderId: order.id,
              type: InventoryTransactionType.INBOUND,
              invoiceCode: code,
              hubId,
              tripId: linkedTripId,
              tripCode: rowTripCode || null,
              quantity: actualQty,
              expectedQuantity: expectedQty,
              discrepancyQuantity: discrepancy,
              discrepancyReason,
              remainingQuantity: order.remainingQuantity ?? actualQty,
              weight: actualWeight,
              volume: actualVolume,
              licensePlate: inboundPlate || null,
              driverName: inboundDriver || null,
              destination: order.destinationHub || order.province || null,
              performedByUserId: user.id,
              notes:
                discrepancy !== 0
                  ? `Nhập kho tại ${hubName}: thực nhận ${actualQty}/${expectedQty} kiện (${discrepancy > 0 ? 'thừa' : 'thiếu'} ${Math.abs(discrepancy)} kiện)`
                  : inboundPlate
                    ? `Nhập kho từ xe ${inboundPlate} tại ${hubName}`
                    : `Tiếp nhận lưu kho tại ${hubName}`,
            }),
          );
        }
      }

      // Vehicle info corrections on the trip allocation rows (operational, not contract)
      if (sharedTripCode && (inboundPlate || inboundDriver || inboundDate)) {
        const existingTrips = await tripRepo.find({ where: { tripCode: sharedTripCode } });
        for (const t of existingTrips) {
          if (inboundPlate) t.licensePlate = inboundPlate;
          if (inboundDriver) t.driverName = inboundDriver;
          if (inboundDate) t.pickupDate = inboundDate;
        }
        if (existingTrips.length > 0) await tripRepo.save(existingTrips);
      }
      if (tripId) {
        const trip = await tripRepo.findOne({ where: { id: tripId } });
        if (trip && !isKeepStatus) {
          trip.notes = (trip.notes ? `${trip.notes} · ` : '') + `Đã dỡ hàng tại ${hubName}`;
          await tripRepo.save(trip);
        }
      }

      // Per-hub trip status: this hub becomes "Đã xử lý" (or stays "Chờ xử lý" on save draft)
      if (hubId) {
        for (const code of processedTripCodes) {
          await this.ledgerService.upsertTripStop(
            {
              tripCode: code,
              hubId,
              status: isKeepStatus ? TripStopStatus.PENDING : TripStopStatus.COMPLETED,
              stopType: TripStopType.DESTINATION,
              stopSequence: 1,
              userId: user.id,
            },
            manager,
          );

          if (!isKeepStatus) {
            // All stops processed → the trip is fully unloaded
            await manager.query(
              `UPDATE "trip" SET "status" = 'COMPLETED', "updatedAt" = NOW()
               WHERE "tripCode" = $1 AND "deletedAt" IS NULL AND "status" <> 'COMPLETED'
                 AND NOT EXISTS (SELECT 1 FROM "trip_stop" s WHERE s."tripCode" = $1 AND s."status" = 'PENDING' AND s."deletedAt" IS NULL)`,
              [code],
            );
          }
        }
      }

      return {
        updatedCount: savedOrders.length - newCreatedCount,
        newCount: newCreatedCount,
        orders: savedOrders,
        invoiceCode,
        tripCode: sharedTripCode || null,
      };
    });
  }

  /**
   * Confirm outbound dispatch (Customer vs Transfer).
   * - Validates against the stock of the dispatching hub (invoice ledger).
   * - Allocates ONE SD trip code + ONE dispatch invoice for the whole vehicle.
   * - Never modifies Master Contract fields (destinationHubId stays the contract destination;
   *   transfer routing is represented by trip stops).
   */
  async confirmOutbound(
    user: UserEntity,
    dto: ConfirmOutboundDto,
  ): Promise<{
    updatedCount: number;
    orders: OrderEntity[];
    trip?: TripEntity;
    tripCode?: string;
    invoiceCode?: string;
  }> {
    const targetOrderIds =
      dto.items && dto.items.length > 0
        ? dto.items.map((i) => i.orderId)
        : dto.orderIds || [];

    if (!targetOrderIds || targetOrderIds.length === 0) {
      throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
    }

    const userHubId = (await this.resolveUserHubId(user)) ?? null;

    return this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(OrderEntity);
      const tripRepo = manager.getRepository(TripEntity);
      const txRepo = manager.getRepository(OrderInventoryTransactionEntity);
      const hubRepo = manager.getRepository(HubEntity);

      const orders = await orderRepo.find({
        where: { id: In(targetOrderIds) },
      });

      if (orders.length === 0) {
        throw new NotFoundException('Không tìm thấy đơn hàng nào để xuất kho');
      }

      const isTransfer = dto.mode === OutboundMode.TRANSFER;
      let destHubName = '';
      if (isTransfer && dto.destinationHubId) {
        const destHub = await hubRepo.findOne({
          where: { id: dto.destinationHubId },
        });
        if (destHub) {
          destHubName = destHub.name;
        }
      }

      const originHubId =
        userHubId ?? orders[0].currentHubId ?? orders[0].originHubId ?? null;
      const tripCode = await this.ledgerService.generateTripCode(manager);
      const invoiceCode = await this.ledgerService.generateInvoiceCode(
        isTransfer ? InventoryTransactionType.TRANSFER : InventoryTransactionType.OUTBOUND,
        originHubId,
        manager,
      );
      const dispatchDate =
        (dto as any).dispatchDate || new Date().toISOString().split('T')[0];

      let createdTrip: TripEntity | undefined;

      for (const order of orders) {
        const item = dto.items?.find((i) => i.orderId === order.id);
        const actingHubId =
          userHubId ?? order.currentHubId ?? order.originHubId ?? null;

        const hubStock = actingHubId
          ? await this.ledgerService.getHubStock(order.id, actingHubId, manager)
          : null;
        const availableQty =
          hubStock !== null
            ? hubStock
            : order.remainingQuantity !== undefined && order.remainingQuantity !== null
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
            `Mã đơn ${order.orderCode}: Số lượng xuất (${qtyToExport}) vượt quá tồn kho khả dụng tại kho (${availableQty} kiện).`,
          );
        }

        const hubStockAfter = Math.max(0, availableQty - qtyToExport);
        order.outboundQuantity = (order.outboundQuantity || 0) + qtyToExport;
        order.remainingQuantity = Math.max(
          0,
          (Number(order.remainingQuantity) || 0) - qtyToExport,
        );

        if (order.remainingQuantity === 0) {
          order.status = 'COMPLETED_INBOUND'; // ĐÃ XUẤT KHO toàn bộ
        } else {
          order.status = 'INBOUND'; // Còn tồn kho, giữ LƯU KHO để xuất đợt tiếp theo
        }

        if (isTransfer) {
          order.currentTripCode = tripCode;
        }
        if (hubStockAfter === 0 && order.currentHubId === actingHubId) {
          order.currentHubId = null;
        }

        const weight = Number(
          item?.weightToExport ??
            this.proportional(order.totalWeight, qtyToExport, order.totalQuantity),
        );
        const volume = Number(
          item?.volumeToExport ??
            this.proportional(order.totalVolume, qtyToExport, order.totalQuantity),
        );

        const tripNotes = isTransfer
          ? `[XUẤT KHO - LUÂN CHUYỂN] Xuất ${qtyToExport} kiện đến ${destHubName || order.destinationHub || 'Kho đích'}`
          : `[XUẤT KHO - GIAO KHÁCH] Xuất ${qtyToExport} kiện giao khách`;

        createdTrip = await tripRepo.save(
          tripRepo.create({
            orderId: order.id,
            tripCode,
            licensePlate: dto.licensePlate || 'Xe xuất kho',
            driverName: dto.driverName || 'Tài xế giao hàng',
            status: 'IN_TRANSIT',
            pickupDate: dispatchDate,
            weightAllocated: weight,
            volumeAllocated: volume,
            notes: tripNotes,
          }),
        );

        // Dispatch invoice (Phiếu xuất luân chuyển / Phiếu giao khách)
        await txRepo.save(
          txRepo.create({
            orderId: order.id,
            type: isTransfer
              ? InventoryTransactionType.TRANSFER
              : InventoryTransactionType.OUTBOUND,
            invoiceCode,
            hubId: actingHubId,
            tripId: createdTrip.id,
            tripCode,
            quantity: qtyToExport,
            expectedQuantity: qtyToExport,
            discrepancyQuantity: 0,
            remainingQuantity: hubStockAfter,
            weight,
            volume,
            licensePlate: dto.licensePlate || null,
            driverName: dto.driverName || null,
            destination: isTransfer
              ? destHubName || order.destinationHub || 'Kho đích'
              : (order.destinationHub || order.province || 'Giao khách'),
            performedByUserId: user.id,
            notes: isTransfer
              ? `Xuất ${qtyToExport} kiện luân chuyển đến ${destHubName || order.destinationHub || 'Kho đích'} trên chuyến ${tripCode}`
              : `Xuất ${qtyToExport} kiện giao khách trên chuyến ${tripCode}`,
          }),
        );
      }

      const saved = await orderRepo.save(orders);

      // Trip stops: origin "Đã xử lý"; every receiving hub on the route "Chờ xử lý"
      if (originHubId) {
        await this.ledgerService.upsertTripStop(
          {
            tripCode,
            hubId: originHubId,
            status: TripStopStatus.COMPLETED,
            stopType: TripStopType.ORIGIN,
            stopSequence: 1,
            userId: user.id,
          },
          manager,
        );
      }
      if (isTransfer) {
        const targets = Array.from(
          new Set(
            [dto.destinationHubId ?? null, ...saved.map((o) => o.destinationHubId)].filter(
              (h): h is number => !!h && h !== originHubId,
            ),
          ),
        );
        for (let i = 0; i < targets.length; i++) {
          await this.ledgerService.upsertTripStop(
            {
              tripCode,
              hubId: targets[i],
              status: TripStopStatus.PENDING,
              stopType:
                i === targets.length - 1 ? TripStopType.DESTINATION : TripStopType.TRANSIT,
              stopSequence: i + 2,
            },
            manager,
          );
        }
      }

      return {
        updatedCount: saved.length,
        orders: saved,
        trip: createdTrip,
        tripCode,
        invoiceCode,
      };
    });
  }

  /**
   * Get KPI metrics for warehouse dashboard cards & tab counters (hub-scoped statuses).
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
    const { userHubId, useHubContext } = await this.resolveHubContext(user);
    const statusExpr = useHubContext
      ? this.ledgerService.hubStatusSql()
      : 'order.status';

    const qb = this.orderRepository
      .createQueryBuilder('order')
      .select('order.id', 'id')
      .addSelect(statusExpr, 'hs')
      .addSelect(`CASE WHEN ${TRANSFER_INBOUND_SQL} THEN 1 ELSE 0 END`, 'isTransferIn')
      .addSelect(`CASE WHEN ${TRANSFER_OUTBOUND_SQL} THEN 1 ELSE 0 END`, 'isTransferOut')
      .where('order.deletedAt IS NULL');

    if (useHubContext) {
      qb.andWhere(this.ledgerService.hubScopeSql()).setParameter('userHubId', userHubId);
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

    const rows = await qb.getRawMany();

    let waitingInbound = 0;
    let customerInbound = 0;
    let transferInbound = 0;
    let storedInbound = 0;
    let customerOutbound = 0;
    let transferOutbound = 0;
    let completedOutbound = 0;

    for (const r of rows) {
      const isTransferIn = Number(r.isTransferIn) === 1;
      const isTransferOut = Number(r.isTransferOut) === 1;
      if (WAITING_STATUSES.includes(r.hs)) {
        waitingInbound++;
        if (isTransferIn) transferInbound++;
        else customerInbound++;
      }
      if (STORED_STATUSES.includes(r.hs)) {
        storedInbound++;
        if (isTransferOut) transferOutbound++;
        else customerOutbound++;
      }
      if (DISPATCHED_STATUSES.includes(r.hs)) {
        completedOutbound++;
      }
    }

    return {
      total: rows.length,
      waitingInbound,
      customerInbound,
      transferInbound,
      storedInbound,
      waitingOutbound: storedInbound,
      customerOutbound,
      transferOutbound,
      completedOutbound,
      completedOutboundToday: completedOutbound,
    };
  }

  /**
   * List logical trips (grouped by SD trip code) that stop at the current hub,
   * with the hub-scoped trip status: PENDING (Chờ xử lý) / COMPLETED (Đã xử lý).
   */
  async getInboundTrips(
    user: UserEntity,
    query: {
      search?: string;
      status?: string;
      page?: number;
      limit?: number;
    },
  ): Promise<{ data: any[]; meta: any }> {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(50, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const userHubId = await this.resolveUserHubId(user);
    const params: any[] = [];
    const where: string[] = [`ts."deletedAt" IS NULL`];

    if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER && userHubId) {
      params.push(userHubId);
      where.push(`ts."hubId" = $${params.length}`);
      // Origin stops are outbound trips of this hub, not inbound
      where.push(`ts."stopType" <> 'ORIGIN'`);
    }

    const statusUpper = query?.status?.toUpperCase();
    if (statusUpper === 'PENDING' || statusUpper === 'COMPLETED') {
      params.push(statusUpper);
      where.push(`ts."status" = $${params.length}`);
    }

    if (query?.search && query.search.trim()) {
      params.push(`%${query.search.trim()}%`);
      const p = `$${params.length}`;
      where.push(
        `(ts."tripCode" ILIKE ${p} OR EXISTS (SELECT 1 FROM "trip" st WHERE st."tripCode" = ts."tripCode" AND st."deletedAt" IS NULL AND (st."licensePlate" ILIKE ${p} OR st."driverName" ILIKE ${p})))`,
      );
    }

    const whereSql = where.join(' AND ');

    const totalRows = await this.dataSource.query(
      `SELECT COUNT(*)::int AS "total" FROM "trip_stop" ts WHERE ${whereSql}`,
      params,
    );
    const total = Number(totalRows?.[0]?.total) || 0;

    const rows: any[] = await this.dataSource.query(
      `SELECT ts."tripCode", ts."status", ts."stopType", ts."hubId", ts."processedAt", ts."createdAt",
              h."name" AS "hubName",
              (SELECT oh."name" FROM "trip_stop" os JOIN "hub" oh ON oh.id = os."hubId"
                WHERE os."tripCode" = ts."tripCode" AND os."stopType" = 'ORIGIN' AND os."deletedAt" IS NULL
                LIMIT 1) AS "originHubName",
              agg."firstTripId", agg."licensePlate", agg."driverName", agg."pickupDate",
              agg."ordersCount", agg."ordersForHubCount", agg."totalWeight", agg."totalVolume"
       FROM "trip_stop" ts
       JOIN "hub" h ON h.id = ts."hubId"
       LEFT JOIN LATERAL (
         SELECT MIN(t.id) AS "firstTripId",
                MAX(t."licensePlate") AS "licensePlate",
                MAX(t."driverName") AS "driverName",
                MAX(t."pickupDate") AS "pickupDate",
                COUNT(DISTINCT t."orderId")::int AS "ordersCount",
                COUNT(DISTINCT t."orderId") FILTER (
                  WHERE o."destinationHubId" = ts."hubId" OR o."destinationHubId" IS NULL
                     OR NOT EXISTS (SELECT 1 FROM "trip_stop" ds WHERE ds."tripCode" = ts."tripCode" AND ds."hubId" = o."destinationHubId" AND ds."deletedAt" IS NULL)
                )::int AS "ordersForHubCount",
                COALESCE(SUM(t."weightAllocated"), 0) AS "totalWeight",
                COALESCE(SUM(t."volumeAllocated"), 0) AS "totalVolume"
         FROM "trip" t
         JOIN "order" o ON o.id = t."orderId"
         WHERE t."tripCode" = ts."tripCode" AND t."deletedAt" IS NULL
       ) agg ON true
       WHERE ${whereSql}
       ORDER BY CASE WHEN ts."status" = 'PENDING' THEN 0 ELSE 1 END, ts."createdAt" DESC
       LIMIT ${limit} OFFSET ${skip}`,
      params,
    );

    const formatted = rows.map((r) => ({
      id: r.firstTripId != null ? Number(r.firstTripId) : null,
      tripCode: r.tripCode,
      vehicleLicensePlate: r.licensePlate || '',
      driverName: r.driverName || '',
      pickupDate: r.pickupDate || null,
      /** Hub-scoped trip status: PENDING = Chờ xử lý, COMPLETED = Đã xử lý */
      status: r.status,
      hubStatus: r.status,
      stopType: r.stopType,
      hubId: Number(r.hubId),
      originHub: r.originHubName || '',
      destinationHub: r.hubName || '',
      ordersCount: Number(r.ordersCount) || 0,
      remainingOrdersCount: Number(r.ordersForHubCount) || 0,
      totalWeight: Number(r.totalWeight) || 0,
      totalVolume: Number(r.totalVolume) || 0,
      processedAt: r.processedAt,
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

  /**
   * Full manifest of a logical trip (all order lines on the vehicle) as seen by the viewer hub:
   * which lines are to be unloaded here, expected / already received quantities, per-hub stop status.
   * Read-only — never alters data (skipping a line keeps it on the truck for the next hub).
   */
  async getTripManifest(user: UserEntity, tripCodeParam: string): Promise<any> {
    const code = normalizeTripCode(decodeURIComponent(tripCodeParam || ''));
    if (!code) {
      throw new NotFoundException('Không tìm thấy chuyến xe');
    }
    const viewerHubId = (await this.resolveUserHubId(user)) ?? null;

    const baseQb = () =>
      this.tripRepository
        .createQueryBuilder('trip')
        .leftJoinAndSelect('trip.order', 'order')
        .leftJoinAndSelect('order.originHubEntity', 'originHubEntity')
        .leftJoinAndSelect('order.destinationHubEntity', 'destinationHubEntity')
        .where('trip.deletedAt IS NULL')
        .andWhere('order.deletedAt IS NULL');

    let trips = await baseQb()
      .andWhere('trip.tripCode = :code', { code })
      .orderBy('trip.id', 'ASC')
      .getMany();

    // Legacy groups without a persisted code are displayed as TRIP-{id}
    const legacy = /^TRIP-(\d+)$/i.exec(code);
    if (trips.length === 0 && legacy) {
      trips = await baseQb()
        .andWhere('trip.id = :id', { id: Number(legacy[1]) })
        .getMany();
    }
    if (trips.length === 0) {
      throw new NotFoundException(`Không tìm thấy chuyến xe ${code}`);
    }

    const stops: any[] = await this.dataSource.query(
      `SELECT ts."hubId", h."name" AS "hubName", ts."stopSequence", ts."stopType", ts."status", ts."processedAt"
       FROM "trip_stop" ts JOIN "hub" h ON h.id = ts."hubId"
       WHERE ts."tripCode" = $1 AND ts."deletedAt" IS NULL
       ORDER BY ts."stopSequence" ASC, ts.id ASC`,
      [code],
    );
    const stopHubIds = new Set<number>(stops.map((s) => Number(s.hubId)));

    const sums: any[] = await this.dataSource.query(
      `SELECT "orderId", "type", "hubId", COALESCE(SUM("quantity"), 0)::int AS "qty"
       FROM "order_inventory_transaction"
       WHERE "tripCode" = $1 AND "deletedAt" IS NULL
       GROUP BY "orderId", "type", "hubId"`,
      [code],
    );

    const orderIds = Array.from(new Set(trips.map((t) => t.orderId)));
    const hubView = viewerHubId
      ? await this.computeHubView(orderIds, viewerHubId)
      : new Map<number, { hubStatus: string; hubStock: number }>();

    const seen = new Set<number>();
    const lines = trips
      .filter((t) => {
        if (seen.has(t.orderId)) return false;
        seen.add(t.orderId);
        return true;
      })
      .map((t) => {
        const o = t.order;
        const mine = sums.filter((s) => Number(s.orderId) === o.id);
        const loaded = mine
          .filter((s) => s.type === InventoryTransactionType.TRANSFER)
          .reduce((a, s) => a + Number(s.qty), 0);
        const receivedAll = mine
          .filter((s) => s.type === InventoryTransactionType.INBOUND)
          .reduce((a, s) => a + Number(s.qty), 0);
        const receivedHere = viewerHubId
          ? mine
              .filter(
                (s) =>
                  s.type === InventoryTransactionType.INBOUND &&
                  Number(s.hubId) === viewerHubId,
              )
              .reduce((a, s) => a + Number(s.qty), 0)
          : 0;
        const expectedQuantity = loaded > 0 ? loaded : Number(o.totalQuantity) || 0;
        const inTransitQuantity = loaded > 0 ? Math.max(0, loaded - receivedAll) : 0;

        const isForCurrentHub = viewerHubId
          ? o.destinationHubId === viewerHubId ||
            !o.destinationHubId ||
            !stopHubIds.has(o.destinationHubId)
          : true;

        let pickupAddress = o.originHub || '';
        let deliveryAddress = '';
        if (o.route && o.route.includes('→')) {
          const parts = o.route.split('→');
          if (!pickupAddress || pickupAddress === 'Hub') pickupAddress = parts[0]?.trim() || '';
          deliveryAddress = parts[1]?.trim() || '';
        }

        const view = hubView.get(o.id);
        return {
          ...o,
          pickupAddress: pickupAddress || o.originHubEntity?.name || '',
          deliveryAddress:
            deliveryAddress || o.destinationHub || o.destinationHubEntity?.name || '',
          tripId: t.id,
          weightAllocated: Number(t.weightAllocated) || 0,
          volumeAllocated: Number(t.volumeAllocated) || 0,
          expectedQuantity,
          inTransitQuantity,
          receivedQuantity: receivedHere,
          isForCurrentHub,
          isReceivedHere: receivedHere > 0,
          isContractLocked: !DRAFT_LIKE_STATUSES.includes(o.status),
          hubStatus: view?.hubStatus ?? o.status,
          hubStock: view ? view.hubStock : null,
        };
      });

    const first = trips[0];
    const currentStop = viewerHubId
      ? stops.find((s) => Number(s.hubId) === viewerHubId)
      : undefined;

    return {
      tripCode: first.tripCode || code,
      licensePlate: first.licensePlate || '',
      driverName: first.driverName || '',
      pickupDate: first.pickupDate || null,
      isTransfer:
        stops.length > 1 ||
        sums.some((s) => s.type === InventoryTransactionType.TRANSFER),
      stops: stops.map((s) => ({
        hubId: Number(s.hubId),
        hubName: s.hubName,
        stopSequence: Number(s.stopSequence),
        stopType: s.stopType,
        status: s.status,
        processedAt: s.processedAt,
      })),
      currentHubId: viewerHubId,
      /** PENDING = Chờ xử lý, COMPLETED = Đã xử lý, null = chuyến không dừng tại kho này */
      currentHubStatus: currentStop?.status ?? null,
      lines,
    };
  }
}
