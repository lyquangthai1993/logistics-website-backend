import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorResponse } from '../interfaces/api-response.interface';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Lỗi máy chủ nội bộ (Internal server error)';
    let errors: Record<string, any> | string[] | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;

        if (resObj.errors) {
          errors = resObj.errors;
          message =
            typeof resObj.message === 'string'
              ? resObj.message
              : 'Dữ liệu không hợp lệ (Validation failed)';
        } else if (Array.isArray(resObj.message)) {
          errors = resObj.message;
          message = resObj.message.join(', ');
        } else if (typeof resObj.message === 'string') {
          message = resObj.message;
          errors = resObj.error || null;
        } else {
          message = exception.message || 'HTTP Error';
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled Exception on ${request?.method} ${request?.url}: ${exception.message}`,
        exception.stack,
      );
      if (process.env.NODE_ENV !== 'production') {
        message = exception.message || 'Internal server error';
      }
    }

    const errorResponse: ApiErrorResponse = {
      statusCode: status,
      message,
      errors,
      timestamp: new Date().toISOString(),
      path: request?.url || '',
    };

    response.status(status).json(errorResponse);
  }
}
