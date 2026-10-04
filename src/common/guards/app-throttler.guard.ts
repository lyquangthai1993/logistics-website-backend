import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 1. If user is authenticated via Bearer token, throttle per token/session
    // This prevents all office/warehouse users on the same NAT or proxy from sharing one rate-limit quota.
    const authHeader = req.headers?.authorization;
    if (
      typeof authHeader === 'string' &&
      authHeader.startsWith('Bearer ') &&
      authHeader.length > 20
    ) {
      return `auth-${authHeader.slice(-32)}`;
    }

    // 2. If req.user is already populated by passport/session
    if (req.user?.id) {
      return `user-${req.user.id}`;
    }

    // 3. Extract real client IP from X-Forwarded-For if behind a reverse proxy (Render, Vercel, Cloudflare)
    const forwarded = req.headers?.['x-forwarded-for'];
    if (forwarded) {
      const clientIp =
        typeof forwarded === 'string'
          ? forwarded.split(',')[0].trim()
          : Array.isArray(forwarded)
            ? forwarded[0]
            : null;
      if (clientIp) return clientIp;
    }

    // 4. Default to req.ips or req.ip
    return req.ips?.length ? req.ips[0] : req.ip || 'unknown';
  }
}
