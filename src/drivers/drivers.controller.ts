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
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { DriverEntity } from './infrastructure/persistence/relational/entities/driver.entity';

@ApiBearerAuth()
@Roles(RoleEnum.SUPER_ADMIN, RoleEnum.FLEET_MANAGER)
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Drivers')
@Controller({
  path: 'drivers',
  version: '1',
})
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @ApiCreatedResponse({
    type: DriverEntity,
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDriverDto: CreateDriverDto): Promise<DriverEntity> {
    return this.driversService.create(createDriverDto);
  }

  @ApiOkResponse({
    type: [DriverEntity],
  })
  @Get()
  @HttpCode(HttpStatus.OK)
  findAll(): Promise<DriverEntity[]> {
    return this.driversService.findAll();
  }

  @ApiOkResponse({
    type: DriverEntity,
  })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  findOne(@Param('id') id: string): Promise<DriverEntity> {
    return this.driversService.findOne(+id);
  }

  @ApiOkResponse({
    type: DriverEntity,
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
    @Body() updateDriverDto: UpdateDriverDto,
  ): Promise<DriverEntity> {
    return this.driversService.update(+id, updateDriverDto);
  }

  @Delete(':id')
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.driversService.remove(+id);
  }
}
