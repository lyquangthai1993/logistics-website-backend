import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response, Request } from 'express';
import { ApiResponse } from '../interfaces/api-response.interface';
import { SILENT_RESPONSE_KEY } from '../decorators/silent-response.decorator';

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  constructor(@Optional() private readonly reflector?: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | T> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // Check if handler or controller is decorated with @SilentResponse()
    const isSilent = this.reflector
      ? (this.reflector.getAllAndOverride<boolean>(SILENT_RESPONSE_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? false)
      : false;

    // Skip wrapping for Swagger docs, health checks or download endpoints
    const url = request?.url || '';
    if (
      url.includes('/docs') ||
      url.includes('/health') ||
      url.includes('/files/download')
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((resData) => {
        const statusCode = response.statusCode || HttpStatus.OK;

        // HTTP 204 No Content should not return a response body
        if (statusCode === HttpStatus.NO_CONTENT) {
          return resData;
        }

        const timestamp = new Date().toISOString();

        // Handle already wrapped PaginatedResult: { data: [...], meta: { ... } }
        if (
          resData &&
          typeof resData === 'object' &&
          'data' in resData &&
          'meta' in resData
        ) {
          return {
            statusCode,
            message: 'Success',
            ...(isSilent ? { silent: true } : {}),
            data: resData.data,
            meta: resData.meta,
            timestamp,
          };
        }

        // Handle InfinityPaginationResponseDto: { data: [...], hasNextPage: boolean }
        if (
          resData &&
          typeof resData === 'object' &&
          'data' in resData &&
          'hasNextPage' in resData
        ) {
          return {
            statusCode,
            message: 'Success',
            ...(isSilent ? { silent: true } : {}),
            data: resData.data,
            meta: {
              hasNextPage: resData.hasNextPage,
            },
            timestamp,
          };
        }

        // Handle custom paginated object with top-level total: { data: [...], total, page, limit }
        if (
          resData &&
          typeof resData === 'object' &&
          'data' in resData &&
          Array.isArray(resData.data) &&
          ('total' in resData || 'totalPages' in resData)
        ) {
          const {
            data: items,
            total,
            page,
            limit,
            totalPages,
            ...rest
          } = resData as any;
          return {
            statusCode,
            message: 'Success',
            ...(isSilent ? { silent: true } : {}),
            data: items,
            meta: {
              total,
              page,
              limit,
              totalPages,
              ...rest,
            },
            timestamp,
          };
        }

        // Handle empty or primitive responses
        if (resData === undefined || resData === null) {
          return {
            statusCode,
            message: 'Success',
            ...(isSilent ? { silent: true } : {}),
            data: null as unknown as T,
            timestamp,
          };
        }

        // Standard object/array response
        return {
          statusCode,
          message: 'Success',
          ...(isSilent ? { silent: true } : {}),
          data: resData,
          timestamp,
        };
      }),
    );
  }
}
