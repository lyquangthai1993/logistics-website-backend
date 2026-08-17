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
import { TripsService } from './trips.service';
import { CreateTripDto } from './dto/create-trip.dto';
import { CreateSplitTripsDto } from './dto/create-split-trips.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { QueryTripDto } from './dto/query-trip.dto';
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
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER, RoleEnum.DISPATCHER)
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
    type: [TripEntity],
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(@Query() query: QueryTripDto): Promise<TripEntity[]> {
    return this.tripsService.findAll(query);
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
  @Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER, RoleEnum.DISPATCHER)
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
