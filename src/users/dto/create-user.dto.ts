import {
  // decorators here
  Transform,
  Type,
} from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  // decorators here
  IsEmail,
  IsNotEmpty,
  IsOptional,
  MinLength,
  ValidateNested,
  IsInt,
  IsPositive,
} from 'class-validator';
import { FileDto } from '../../files/dto/file.dto';
import { RoleDto } from '../../roles/dto/role.dto';
import { StatusDto } from '../../statuses/dto/status.dto';
import { lowerCaseTransformer } from '../../utils/transformers/lower-case.transformer';

export class HubReferenceDto {
  @ApiProperty({ example: 1, description: 'Hub ID to assign to this user' })
  @IsInt()
  @IsPositive()
  id: number;
}

export class CreateUserDto {
  @ApiPropertyOptional({ example: 'admin', type: String })
  @Transform(lowerCaseTransformer)
  @IsOptional()
  username?: string | null;

  @ApiProperty({ example: 'test1@example.com', type: String })
  @Transform(lowerCaseTransformer)
  @IsNotEmpty()
  @IsEmail()
  email: string | null;

  @ApiProperty()
  @MinLength(6)
  password?: string;

  provider?: string;

  socialId?: string | null;

  @ApiProperty({ example: 'John', type: String })
  @IsNotEmpty()
  firstName: string | null;

  @ApiProperty({ example: 'Doe', type: String })
  @IsNotEmpty()
  lastName: string | null;

  @ApiPropertyOptional({ type: () => FileDto })
  @IsOptional()
  photo?: FileDto | null;

  @ApiPropertyOptional({ type: RoleDto })
  @IsOptional()
  @Type(() => RoleDto)
  role?: RoleDto | null;

  @ApiPropertyOptional({ type: StatusDto })
  @IsOptional()
  @Type(() => StatusDto)
  status?: StatusDto;

  @ApiPropertyOptional({
    type: () => HubReferenceDto,
    description: 'Hub to assign — required when role is WAREHOUSE_MANAGER',
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => HubReferenceDto)
  hub?: HubReferenceDto | null;
}
