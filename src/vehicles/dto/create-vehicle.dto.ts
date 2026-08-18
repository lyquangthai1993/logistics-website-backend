import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateVehicleDto {
  @ApiProperty({ example: '75H-051.21' })
  @IsNotEmpty()
  @IsString()
  licensePlate: string;

  @ApiPropertyOptional({ example: 'Volvo FH16' })
  @IsOptional()
  @IsString()
  model?: string;

  @ApiProperty({ example: 'CONTAINER_40FT' })
  @IsNotEmpty()
  @IsString()
  type: string;

  @ApiProperty({ example: 25000 })
  @IsNotEmpty()
  @IsNumber()
  maxWeight: number;

  @ApiProperty({ example: 65.5 })
  @IsNotEmpty()
  @IsNumber()
  maxVolume: number;

  @ApiPropertyOptional({ example: 'Andromeda Hub' })
  @IsOptional()
  @IsString()
  currentHub?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  hubId?: number;

  @ApiPropertyOptional({ example: 'AVAILABLE' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  assignedDriverId?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  isExternal?: boolean;

  @ApiPropertyOptional({ example: 'Công ty TNHH Vận Tải ABC' })
  @IsOptional()
  @IsString()
  externalProvider?: string;
}
