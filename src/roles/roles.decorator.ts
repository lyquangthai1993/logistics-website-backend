import { SetMetadata } from '@nestjs/common';

import { RoleCode } from './roles.enum';

export const Roles = (...roles: RoleCode[]) => SetMetadata('roles', roles);
