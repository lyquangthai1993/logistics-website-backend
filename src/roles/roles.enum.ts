export enum RoleEnum {
  'SUPER_ADMIN' = 1,
  'DISPATCHER' = 2,
  'FLEET_MANAGER' = 3,
  'WAREHOUSE_MANAGER' = 4,
  'REPORT_VIEWER' = 5,
}

/** Stable role identifiers for authorization metadata and API consumers. */
export enum RoleCode {
  SUPER_ADMIN = 'SUPER_ADMIN',
  DISPATCHER = 'DISPATCHER',
  FLEET_MANAGER = 'FLEET_MANAGER',
  WAREHOUSE_MANAGER = 'WAREHOUSE_MANAGER',
  REPORT_VIEWER = 'REPORT_VIEWER',
}

const LEGACY_ROLE_CODES: Record<number, RoleCode> = {
  [RoleEnum.SUPER_ADMIN]: RoleCode.SUPER_ADMIN,
  [RoleEnum.DISPATCHER]: RoleCode.DISPATCHER,
  [RoleEnum.FLEET_MANAGER]: RoleCode.FLEET_MANAGER,
  [RoleEnum.WAREHOUSE_MANAGER]: RoleCode.WAREHOUSE_MANAGER,
  [RoleEnum.REPORT_VIEWER]: RoleCode.REPORT_VIEWER,
};

/** Resolve the stable code, with an ID fallback for already-issued JWTs. */
export function resolveRoleCode(role: unknown): RoleCode | undefined {
  if (role && typeof role === 'object') {
    const roleObject = role as { roleCode?: unknown; id?: unknown };
    const code = roleObject.roleCode;
    if (
      typeof code === 'string' &&
      Object.values(RoleCode).includes(code as RoleCode)
    ) {
      return code as RoleCode;
    }
    return LEGACY_ROLE_CODES[Number(roleObject.id)];
  }

  return LEGACY_ROLE_CODES[Number(role)];
}
