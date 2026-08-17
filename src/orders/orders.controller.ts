import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpStatus,
  HttpCode,
  Query,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { OrderEntity } from './infrastructure/persistence/relational/entities/order.entity';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Orders')
@Controller({
  path: 'orders',
  version: '1',
})
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @ApiCreatedResponse({
    type: OrderEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.DISPATCHER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createOrderDto: CreateOrderDto,
    @Request() req: any,
  ): Promise<OrderEntity> {
    const userId = req.user?.id;
    return this.ordersService.create(createOrderDto, userId);
  }

  @ApiOkResponse({
    type: [OrderEntity],
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Query() query: QueryOrderDto): Promise<OrderEntity[]> {
    return this.ordersService.findAll(query);
  }

  @ApiOkResponse({
    type: OrderEntity,
  })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  findOne(@Param('id') id: string): Promise<OrderEntity> {
    return this.ordersService.findOne(+id);
  }

  @ApiOkResponse({
    type: OrderEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.DISPATCHER)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  update(
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ): Promise<OrderEntity> {
    return this.ordersService.update(+id, updateOrderDto);
  }

  @ApiOkResponse({
    type: OrderEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.DISPATCHER)
  @Patch(':id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  submit(@Param('id') id: string): Promise<OrderEntity> {
    return this.ordersService.submit(+id);
  }

  @ApiOkResponse({
    type: OrderEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
  @Patch(':id/no-vehicle')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  markNoVehicle(
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ): Promise<OrderEntity> {
    return this.ordersService.markNoVehicle(+id, body?.reason);
  }

  @Delete(':id')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.DISPATCHER)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.ordersService.remove(+id);
  }
}
