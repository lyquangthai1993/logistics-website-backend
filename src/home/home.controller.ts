import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { HomeService } from './home.service';

@ApiTags('Home')
@Controller({
  version: '1',
})
export class HomeController {
  constructor(private readonly service: HomeService) {}

  @Get()
  appInfo() {
    return this.service.appInfo();
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Public Health Check Endpoint',
    description: 'Kiểm tra trạng thái sẵn sàng hoạt động của Backend API.',
  })
  @ApiResponse({
    status: 200,
    description: 'Backend service đang hoạt động bình thường',
  })
  healthCheck() {
    return {
      status: 'ok',
      region: 'ap-southeast-1',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
