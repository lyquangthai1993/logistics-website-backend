import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateDriverDto {
  @ApiProperty({ example: 'Nguyễn Văn Tài' })
  @IsNotEmpty()
  @IsString()
  fullName: string;

  @ApiProperty({ example: '0905123456' })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiPropertyOptional({ example: '790123456789' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiProperty({ example: 'FC' })
  @IsNotEmpty()
  @IsString()
  licenseClass: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsNumber()
  experienceYears?: number;

  @ApiPropertyOptional({ example: 'AVAILABLE' })
  @IsOptional()
  @IsString()
  status?: string;
}
