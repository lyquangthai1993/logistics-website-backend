import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayloadType } from '../auth/strategies/types/jwt-payload.type';
import type { RequestWithUser } from '../utils/types/request-with-user.type';
import { resolveRoleCode, RoleCode } from './roles.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<RoleCode[] | undefined>(
      'roles',
      [context.getClass(), context.getHandler()],
    );
    if (!roles?.length) {
      const request = context
        .switchToHttp()
        .getRequest<RequestWithUser<JwtPayloadType | undefined>>();

      // REPORT_VIEWER is opt-in: routes must explicitly list the role.
      // This prevents an unannotated authenticated route from becoming a
      // data-access path simply because it has no role metadata.
      if (resolveRoleCode(request.user?.role) === RoleCode.REPORT_VIEWER) {
        return false;
      }

      return true;
    }
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser<JwtPayloadType | undefined>>();

    const roleCode = resolveRoleCode(request.user?.role);
    return Boolean(roleCode && roles.includes(roleCode));
  }
}
