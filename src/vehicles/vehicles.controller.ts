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
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiParam, ApiTags } from '@nestjs/swagger';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../roles/roles.guard';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleEntity } from './infrastructure/persistence/relational/entities/vehicle.entity';

@ApiBearerAuth()
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Vehicles')
@Controller({
  path: 'vehicles',
  version: '1',
})
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @ApiCreatedResponse({
    type: VehicleEntity,
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createVehicleDto: CreateVehicleDto): Promise<VehicleEntity> {
    return this.vehiclesService.create(createVehicleDto);
  }

  @ApiOkResponse({
    type: [VehicleEntity],
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(): Promise<VehicleEntity[]> {
    return this.vehiclesService.findAll();
  }

  @ApiOkResponse({
    type: VehicleEntity,
  })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  findOne(@Param('id') id: string): Promise<VehicleEntity> {
    return this.vehiclesService.findOne(+id);
  }

  @ApiOkResponse({
    type: VehicleEntity,
  })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  update(
    @Param('id') id: string,
    @Body() updateVehicleDto: UpdateVehicleDto,
  ): Promise<VehicleEntity> {
    return this.vehiclesService.update(+id, updateVehicleDto);
  }

  @Delete(':id')
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.vehiclesService.remove(+id);
  }
}
