import { SetMetadata } from '@nestjs/common';

export const SILENT_RESPONSE_KEY = 'silent_response';

/**
 * Decorator to mark an endpoint as a silent background operation.
 * The ResponseTransformInterceptor will include `silent: true` in the ApiResponse envelope,
 * instructing Frontend/Clients not to display a success toast notification.
 */
export const SilentResponse = () => SetMetadata(SILENT_RESPONSE_KEY, true);
