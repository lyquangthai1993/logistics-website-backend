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
import {
  TripsService,
  PaginatedResult,
  TripStatsResult,
} from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { CreateSplitTripsDto } from './dto/create-split-trips.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { QueryTripDto } from './dto/query-trip.dto';
import { QueryTripStatsDto } from './dto/query-trip-stats.dto';
import { TripEntity } from './infrastructure/persistence/relational/entities/trip.entity';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Trips')
@Controller({
  path: 'trips',
  version: '1',
})
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @ApiCreatedResponse({
    type: TripEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createTripDto: CreateTripDto,
    @Request() req: any,
  ): Promise<TripEntity> {
    const userId = req.user?.id;
    return this.tripsService.create(createTripDto, userId);
  }

  @ApiCreatedResponse({
    type: [TripEntity],
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
  @Post('split')
  @HttpCode(HttpStatus.CREATED)
  createSplit(
    @Body() dto: CreateSplitTripsDto,
    @Request() req: any,
  ): Promise<TripEntity[]> {
    const userId = req.user?.id;
    return this.tripsService.createSplit(dto, userId);
  }

  @ApiOkResponse({
    description: 'Danh sách chuyến xe có phân trang',
    schema: {
      properties: {
        data: { type: 'array', items: { type: 'object' } },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            totalPages: { type: 'number' },
          },
        },
      },
    },
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Query() query: QueryTripDto): Promise<PaginatedResult<TripEntity>> {
    return this.tripsService.findAll(query);
  }

  @ApiOkResponse({
    description: 'Thống kê chuyến xe & đơn chờ phân xe theo khoảng thời gian',
    schema: {
      properties: {
        tripsTotal: { type: 'number' },
        tripsPending: { type: 'number' },
        tripsConfirmed: { type: 'number' },
        tripsInTransit: { type: 'number' },
        tripsCompleted: { type: 'number' },
        tripsCancelled: { type: 'number' },
        ordersAwaitingFleet: { type: 'number' },
        ordersNoVehicle: { type: 'number' },
        fromDate: { type: 'string', example: '2026-08-01' },
        toDate: { type: 'string', example: '2026-08-31' },
      },
    },
  })
  @Get('stats')
  @HttpCode(HttpStatus.OK)
  getStats(@Query() query: QueryTripStatsDto): Promise<TripStatsResult> {
    return this.tripsService.getStats(query);
  }

  @ApiOkResponse({
    type: TripEntity,
  })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  findOne(@Param('id') id: string): Promise<TripEntity> {
    return this.tripsService.findOne(+id);
  }

  @ApiOkResponse({
    type: TripEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  update(
    @Param('id') id: string,
    @Body() updateTripDto: UpdateTripDto,
  ): Promise<TripEntity> {
    return this.tripsService.update(+id, updateTripDto);
  }

  @ApiOkResponse({
    type: TripEntity,
  })
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
  @Patch(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  confirm(@Param('id') id: string): Promise<TripEntity> {
    return this.tripsService.confirm(+id);
  }

  @Delete(':id')
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.tripsService.remove(+id);
  }
}
