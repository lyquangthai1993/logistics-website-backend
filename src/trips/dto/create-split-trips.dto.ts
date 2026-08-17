import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { CreateTripDto } from './create-trip.dto';

export class CreateSplitTripsDto {
  @ApiProperty({ example: 1, description: 'ID đơn hàng cần chia xe' })
  @IsNotEmpty()
  @IsNumber()
  orderId: number;

  @ApiProperty({
    type: [CreateTripDto],
    description: 'Danh sách các chuyến xe được chia (2 - 5 xe)',
  })
  @IsArray()
  @ArrayMinSize(2, { message: 'Split shipment cần tối thiểu 2 xe' })
  @ArrayMaxSize(5, { message: 'Split shipment tối đa 5 xe' })
  @ValidateNested({ each: true })
  @Type(() => CreateTripDto)
  trips: CreateTripDto[];
}
