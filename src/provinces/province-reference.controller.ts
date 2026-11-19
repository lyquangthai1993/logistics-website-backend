import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../roles/roles.decorator';
import { RoleEnum } from '../roles/roles.enum';
import { RolesGuard } from '../roles/roles.guard';
import { ProvinceReferenceService } from './province-reference.service';
import { ProvinceReferenceEntity } from './infrastructure/persistence/relational/entities/province-reference.entity';

@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(
  RoleEnum.SUPER_ADMIN,
  RoleEnum.DISPATCHER,
  RoleEnum.FLEET_MANAGER,
  RoleEnum.WAREHOUSE_MANAGER,
)
@ApiTags('Province References')
@Controller({ path: 'province-references', version: '1' })
export class ProvinceReferenceController {
  constructor(private readonly service: ProvinceReferenceService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: [ProvinceReferenceEntity] })
  findAll(): Promise<ProvinceReferenceEntity[]> {
    return this.service.findAll();
  }
}
