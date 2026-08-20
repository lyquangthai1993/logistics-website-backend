export interface PaginatedMeta {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

export interface ApiResponse<T = any> {
  statusCode: number;
  message: string;
  data: T;
  meta?: PaginatedMeta;
  timestamp: string;
}

export interface ApiErrorResponse {
  statusCode: number;
  message: string;
  errors?: Record<string, string | string[]> | string[] | null;
  timestamp: string;
  path: string;
}
