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
import { HubsService, PaginatedResult } from './hubs.service';
import { CreateHubDto } from './dto/create-hub.dto';
import { UpdateHubDto } from './dto/update-hub.dto';
import { QueryHubDto } from './dto/query-hub.dto';
import { HubEntity } from './infrastructure/persistence/relational/entities/hub.entity';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiTags('Hubs')
@Controller({
  path: 'hubs',
  version: '1',
})
export class HubsController {
  constructor(private readonly hubsService: HubsService) {}

  @Roles(RoleEnum.SUPER_ADMIN)
  @ApiCreatedResponse({
    type: HubEntity,
  })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createHubDto: CreateHubDto): Promise<HubEntity> {
    return this.hubsService.create(createHubDto);
  }

  @ApiOkResponse({
    description: 'Danh sách chi nhánh kho có phân trang',
    schema: {
      properties: {
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/HubEntity' },
        },
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
  findAll(@Query() query: QueryHubDto): Promise<PaginatedResult<HubEntity>> {
    return this.hubsService.findAll(query);
  }

  @ApiOkResponse({
    type: [HubEntity],
    description: 'Danh sách gọn nhẹ các chi nhánh kho đang hoạt động (dùng cho dropdown/select)',
  })
  @Get('active')
  @HttpCode(HttpStatus.OK)
  findActive(): Promise<HubEntity[]> {
    return this.hubsService.findActive();
  }

  @ApiOkResponse({
    type: HubEntity,
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  findOne(@Param('id') id: string): Promise<HubEntity> {
    return this.hubsService.findOne(+id);
  }

  @Roles(RoleEnum.SUPER_ADMIN)
  @ApiOkResponse({
    type: HubEntity,
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  update(
    @Param('id') id: string,
    @Body() updateHubDto: UpdateHubDto,
  ): Promise<HubEntity> {
    return this.hubsService.update(+id, updateHubDto);
  }

  @Roles(RoleEnum.SUPER_ADMIN)
  @ApiOkResponse({
    type: HubEntity,
  })
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @Patch(':id/toggle-active')
  @HttpCode(HttpStatus.OK)
  toggleActive(@Param('id') id: string): Promise<HubEntity> {
    return this.hubsService.toggleActive(+id);
  }

  @Roles(RoleEnum.SUPER_ADMIN)
  @ApiParam({
    name: 'id',
    type: Number,
    required: true,
  })
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.hubsService.softDelete(+id);
  }
}
