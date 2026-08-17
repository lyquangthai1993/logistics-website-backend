import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepository: Repository<OrderEntity>,
  ) {}

  async create(
    createOrderDto: CreateOrderDto,
    userId?: number,
  ): Promise<OrderEntity> {
    const existing = await this.orderRepository.findOne({
      where: { orderCode: createOrderDto.orderCode.trim() },
    });

    if (existing) {
      throw new UnprocessableEntityException(
        'Mã đơn hàng đã tồn tại, vui lòng chọn mã khác',
      );
    }

    if (
      createOrderDto.isExternalVehicleNeeded &&
      !createOrderDto.externalNote?.trim()
    ) {
      throw new UnprocessableEntityException(
        'Đơn hàng yêu cầu điều xe ngoài / thuê đối tác bắt buộc phải nhập ghi chú/lý do điều xe ngoài (external_note)',
      );
    }

    const order = this.orderRepository.create({
      ...createOrderDto,
      orderCode: createOrderDto.orderCode.trim(),
      status: 'DRAFT',
      createdByUserId: userId,
    });

    return this.orderRepository.save(order);
  }

  async findAll(query?: QueryOrderDto): Promise<OrderEntity[]> {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.trips', 'trips')
      .leftJoinAndSelect('trips.vehicle', 'vehicle')
      .leftJoinAndSelect('trips.driver', 'driver')
      .where('order.deletedAt IS NULL')
      .orderBy('order.createdAt', 'DESC');

    if (query?.status && query.status !== 'ALL') {
      qb.andWhere('order.status = :status', { status: query.status });
    }

    if (query?.search && query.search.trim()) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(order.orderCode ILIKE :search OR order.route ILIKE :search OR order.goodsDescription ILIKE :search)',
        { search },
      );
    }

    if (query?.originHub) {
      qb.andWhere('order.originHub = :originHub', {
        originHub: query.originHub,
      });
    }

    if (query?.destinationHub) {
      qb.andWhere('order.destinationHub = :destinationHub', {
        destinationHub: query.destinationHub,
      });
    }

    return qb.getMany();
  }

  async findOne(id: number): Promise<OrderEntity> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: ['trips', 'trips.vehicle', 'trips.driver'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async update(
    id: number,
    updateOrderDto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    const order = await this.findOne(id);

    if (
      updateOrderDto.orderCode &&
      updateOrderDto.orderCode.trim() !== order.orderCode
    ) {
      const existing = await this.orderRepository.findOne({
        where: { orderCode: updateOrderDto.orderCode.trim() },
      });
      if (existing) {
        throw new UnprocessableEntityException(
          'Mã đơn hàng đã tồn tại, vui lòng chọn mã khác',
        );
      }
      order.orderCode = updateOrderDto.orderCode.trim();
    }

    const isExtNeeded =
      updateOrderDto.isExternalVehicleNeeded !== undefined
        ? updateOrderDto.isExternalVehicleNeeded
        : order.isExternalVehicleNeeded;
    const finalExtNote =
      updateOrderDto.externalNote !== undefined
        ? updateOrderDto.externalNote
        : order.externalNote;

    if (isExtNeeded && !finalExtNote?.trim()) {
      throw new UnprocessableEntityException(
        'Đơn hàng yêu cầu điều xe ngoài / thuê đối tác bắt buộc phải nhập ghi chú/lý do điều xe ngoài (external_note)',
      );
    }

    Object.assign(order, {
      ...updateOrderDto,
      orderCode: order.orderCode,
    });

    return this.orderRepository.save(order);
  }

  async submit(id: number): Promise<OrderEntity> {
    const order = await this.findOne(id);
    order.status = 'PENDING_FLEET';
    return this.orderRepository.save(order);
  }

  async markNoVehicle(id: number): Promise<OrderEntity> {
    const order = await this.findOne(id);
    order.status = 'NO_VEHICLE';
    return this.orderRepository.save(order);
  }

  async remove(id: number): Promise<void> {
    const order = await this.findOne(id);
    await this.orderRepository.softRemove(order);
  }
}
