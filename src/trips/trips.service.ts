import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { TripEntity } from './infrastructure/persistence/relational/entities/trip.entity';
import { OrderEntity } from '../orders/infrastructure/persistence/relational/entities/order.entity';
import { VehicleEntity } from '../vehicles/infrastructure/persistence/relational/entities/vehicle.entity';
import { DriverEntity } from '../drivers/infrastructure/persistence/relational/entities/driver.entity';
import { UserEntity } from '../users/infrastructure/persistence/relational/entities/user.entity';
import { CreateTripDto } from './dto/create-trip.dto';
import { CreateSplitTripsDto } from './dto/create-split-trips.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { QueryTripDto } from './dto/query-trip.dto';
import { QueryTripStatsDto } from './dto/query-trip-stats.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../mail/mail.service';
import { RoleEnum } from '../roles/roles.enum';

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface TripStatsResult {
  tripsTotal: number;
  tripsPending: number;
  tripsConfirmed: number;
  tripsInTransit: number;
  tripsCompleted: number;
  tripsCancelled: number;
  ordersAwaitingFleet: number; // PENDING_FLEET (realtime — không filter ngày)
  ordersNoVehicle: number;      // NO_VEHICLE (realtime)
  fromDate: string;
  toDate: string;
}




@Injectable()
export class TripsService {
  constructor(
    @InjectRepository(TripEntity)
    private readonly tripRepository: Repository<TripEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
    @InjectRepository(VehicleEntity)
    private readonly vehicleRepository: Repository<VehicleEntity>,
    @InjectRepository(DriverEntity)
    private readonly driverRepository: Repository<DriverEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly mailService: MailService,
  ) {}

  async create(
    createTripDto: CreateTripDto,
    userId?: number,
  ): Promise<TripEntity> {
    const order = await this.orderRepository.findOne({
      where: { id: createTripDto.orderId },
    });
    if (!order) {
      throw new NotFoundException(
        `Order with ID ${createTripDto.orderId} not found`,
      );
    }

    if (createTripDto.vehicleId) {
      const vehicle = await this.vehicleRepository.findOne({
        where: { id: createTripDto.vehicleId },
      });
      if (vehicle?.isExternal) {
        order.isExternalVehicleNeeded = true;
        await this.orderRepository.save(order);
      }
    }

    const trip = this.tripRepository.create({
      ...createTripDto,
      status: 'PENDING',
      sequenceNumber: createTripDto.sequenceNumber || 1,
      assignedByUserId: userId,
    });

    return this.tripRepository.save(trip);
  }

  async createSplit(
    dto: CreateSplitTripsDto,
    userId?: number,
  ): Promise<TripEntity[]> {
    const order = await this.orderRepository.findOne({
      where: { id: dto.orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order with ID ${dto.orderId} not found`);
    }

    // Xóa các chuyến pending cũ nếu phân bổ lại
    await this.tripRepository.delete({
      orderId: dto.orderId,
      status: 'PENDING',
    });

    let hasExternal = false;
    const createdTrips: TripEntity[] = [];

    for (let i = 0; i < dto.trips.length; i++) {
      const item = dto.trips[i];
      if (item.vehicleId) {
        const vehicle = await this.vehicleRepository.findOne({
          where: { id: item.vehicleId },
        });
        if (vehicle?.isExternal) {
          hasExternal = true;
        }
      }

      const trip = this.tripRepository.create({
        orderId: dto.orderId,
        vehicleId: item.vehicleId,
        driverId: item.driverId,
        pickupDate: item.pickupDate,
        pickupTime: item.pickupTime,
        estimatedDeliveryDate: item.estimatedDeliveryDate,
        weightAllocated: item.weightAllocated,
        volumeAllocated: item.volumeAllocated,
        sequenceNumber: i + 1,
        notes: item.notes,
        status: 'PENDING',
        assignedByUserId: userId,
      });

      const saved = await this.tripRepository.save(trip);
      createdTrips.push(saved);
    }

    if (hasExternal) {
      order.isExternalVehicleNeeded = true;
      await this.orderRepository.save(order);
    }

    return createdTrips;
  }

  async confirm(id: number): Promise<TripEntity> {
    const trip = await this.tripRepository.findOne({
      where: { id },
      relations: ['order', 'vehicle', 'driver'],
    });

    if (!trip) {
      throw new NotFoundException(`Trip with ID ${id} not found`);
    }

    trip.status = 'CONFIRMED';
    const savedTrip = await this.tripRepository.save(trip);

    // Kiểm tra tất cả trips của đơn hàng này
    const allTrips = await this.tripRepository.find({
      where: { orderId: trip.orderId },
    });

    const isAllConfirmed =
      allTrips.length > 0 &&
      allTrips.every(
        (t) => t.status === 'CONFIRMED' || t.status === 'COMPLETED',
      );

    if (isAllConfirmed && trip.order) {
      trip.order.status = 'ASSIGNED';
      await this.orderRepository.save(trip.order);
    }

    // Gửi thông báo in-app và email đến các bên liên quan
    try {
      await this.sendTripNotifications(savedTrip);
    } catch (err) {
      // Notification failure should not fail the trip confirmation
      console.warn('Failed to dispatch trip notification/email:', err);
    }

    return savedTrip;
  }

  private async sendTripNotifications(trip: TripEntity): Promise<void> {
    const isExternal = !!trip.vehicle?.isExternal;
    const orderCode = trip.order?.orderCode || `Đơn #${trip.orderId}`;
    const vehiclePlate = trip.vehicle?.licensePlate || 'Chưa gán xe';
    const driverName = trip.driver?.fullName || 'Chưa gán tài xế';
    const driverPhone = trip.driver?.phone || 'N/A';
    const externalProvider =
      trip.vehicle?.externalProvider || 'Đối tác thuê ngoài';

    const title = isExternal
      ? `🚨 [XE THUÊ NGOÀI] Chuyến xe #${trip.id} cho đơn ${orderCode} đã xác nhận`
      : `🚚 Chuyến xe #${trip.id} cho đơn ${orderCode} đã xác nhận`;

    const body = isExternal
      ? `Xe ngoài: ${externalProvider} (${vehiclePlate}) | Tài xế: ${driverName} (${driverPhone}) | Khối lượng: ${trip.weightAllocated} kg | Đích: ${trip.order?.destinationHub || 'Kho nhận'}`
      : `Xe: ${vehiclePlate} | Tài xế: ${driverName} (${driverPhone}) | Khối lượng: ${trip.weightAllocated} kg | Đích: ${trip.order?.destinationHub || 'Kho nhận'}`;

    // Tìm người dùng thuộc các role liên quan (Warehouse Manager, Dispatcher, Fleet Manager, Super Admin)
    const users = await this.userRepository.find({
      where: {
        role: {
          id: In([
            RoleEnum.WAREHOUSE_MANAGER,
            RoleEnum.DISPATCHER,
            RoleEnum.FLEET_MANAGER,
            RoleEnum.SUPER_ADMIN,
          ]),
        },
      },
    });

    // In-app notifications
    for (const user of users) {
      let notifType: 'WAREHOUSE' | 'FLEET' | 'DISPATCHER' | 'GENERIC' =
        'GENERIC';
      if (user.role?.id === RoleEnum.WAREHOUSE_MANAGER) notifType = 'WAREHOUSE';
      else if (user.role?.id === RoleEnum.FLEET_MANAGER) notifType = 'FLEET';
      else if (user.role?.id === RoleEnum.DISPATCHER) notifType = 'DISPATCHER';

      await this.notificationsService.create({
        userId: user.id,
        title,
        body,
        type: notifType,
        metadata: {
          tripId: trip.id,
          orderId: trip.orderId,
          orderCode,
          isExternal,
        },
      });

      // Email notifications
      if (user.email) {
        await this.mailService.sendTripConfirmedNotification({
          to: user.email,
          data: {
            orderCode,
            route: trip.order?.route || undefined,
            originHub: trip.order?.originHub || undefined,
            destinationHub: trip.order?.destinationHub || undefined,
            licensePlate: vehiclePlate,
            isExternal,
            externalProvider,
            driverName,
            driverPhone,
            weightAllocated: trip.weightAllocated,
            volumeAllocated: trip.volumeAllocated,
            pickupDate: trip.pickupDate || undefined,
            pickupTime: trip.pickupTime || undefined,
            estimatedDeliveryDate: trip.estimatedDeliveryDate || undefined,
            goodsDescription: trip.order?.goodsDescription || undefined,
            orderNotes: trip.order?.notes || undefined,
            externalNote: trip.order?.externalNote || undefined,
            tripNotes: trip.notes || undefined,
          },
        });
      }
    }
  }

  async findAll(query?: QueryTripDto): Promise<PaginatedResult<TripEntity>> {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const skip = (page - 1) * limit;

    const qb = this.tripRepository
      .createQueryBuilder('trip')
      .leftJoinAndSelect('trip.order', 'order')
      .leftJoinAndSelect('trip.vehicle', 'vehicle')
      .leftJoinAndSelect('trip.driver', 'driver')
      .where('trip.deletedAt IS NULL')
      .orderBy('trip.createdAt', 'DESC');

    if (query?.status && query.status !== 'ALL') {
      qb.andWhere('trip.status = :status', { status: query.status });
    }

    if (query?.orderId) {
      qb.andWhere('trip.orderId = :orderId', { orderId: +query.orderId });
    }

    if (query?.hub) {
      qb.andWhere(
        '(order.originHub = :hub OR order.destinationHub = :hub OR vehicle.currentHub = :hub)',
        { hub: query.hub },
      );
    }

    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(order.orderCode ILIKE :search OR vehicle.licensePlate ILIKE :search OR driver.fullName ILIKE :search OR trip.notes ILIKE :search)',
        { search },
      );
    }

    if (query?.fromDate) {
      const from = new Date(`${query.fromDate}T00:00:00`);
      qb.andWhere('trip.createdAt >= :fromDate', {
        fromDate: from.toISOString(),
      });
    }

    if (query?.toDate) {
      const to = new Date(`${query.toDate}T23:59:59.999`);
      qb.andWhere('trip.createdAt <= :toDate', {
        toDate: to.toISOString(),
      });
    }

    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }


  async getStats(query?: QueryTripStatsDto): Promise<TripStatsResult> {
    const now = new Date();
    const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultTo = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const from = query?.fromDate ? new Date(`${query.fromDate}T00:00:00`) : defaultFrom;
    const to = query?.toDate ? new Date(`${query.toDate}T23:59:59.999`) : defaultTo;

    // Trips stats theo khoảng ngày (createdAt)
    const tripRows: Array<{ status: string; count: string }> = await this.tripRepository.query(
      `SELECT status, COUNT(*)::int AS count
       FROM "trip"
       WHERE "deletedAt" IS NULL
         AND "createdAt" >= $1
         AND "createdAt" <= $2
       GROUP BY status`,
      [from.toISOString(), to.toISOString()],
    );

    const tripMap: Record<string, number> = {};
    let tripsTotal = 0;
    for (const row of tripRows) {
      tripMap[row.status] = Number(row.count);
      tripsTotal += Number(row.count);
    }

    // Realtime: pending orders count (KHÔNG filter ngày — đây là trạng thái active hiện tại)
    const [pendingFleetCount, noVehicleCount] = await Promise.all([
      this.orderRepository.count({ where: { status: 'PENDING_FLEET' } }),
      this.orderRepository.count({ where: { status: 'NO_VEHICLE' } }),
    ]);

    return {
      tripsTotal,
      tripsPending: tripMap['PENDING'] ?? 0,
      tripsConfirmed: tripMap['CONFIRMED'] ?? 0,
      tripsInTransit: tripMap['IN_TRANSIT'] ?? 0,
      tripsCompleted: tripMap['COMPLETED'] ?? 0,
      tripsCancelled: tripMap['CANCELLED'] ?? 0,
      ordersAwaitingFleet: pendingFleetCount,
      ordersNoVehicle: noVehicleCount,
      fromDate: from.toISOString().split('T')[0],
      toDate: to.toISOString().split('T')[0],
    };
  }

  async findOne(id: number): Promise<TripEntity> {
    const trip = await this.tripRepository.findOne({
      where: { id },
      relations: ['order', 'vehicle', 'driver'],
    });

    if (!trip) {
      throw new NotFoundException(`Trip with ID ${id} not found`);
    }

    return trip;
  }

  async update(id: number, updateTripDto: UpdateTripDto): Promise<TripEntity> {
    const trip = await this.findOne(id);
    Object.assign(trip, updateTripDto);
    return this.tripRepository.save(trip);
  }

  async remove(id: number): Promise<void> {
    const trip = await this.findOne(id);
    await this.tripRepository.softRemove(trip);
  }
}
