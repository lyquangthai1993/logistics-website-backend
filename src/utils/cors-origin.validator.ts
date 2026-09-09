/**
 * Determines whether a given request origin is allowed under the current CORS policy.
 *
 * In Dev Environment (nodeEnv !== 'production' or RENDER_GIT_BRANCH === 'dev'):
 * - Automatically allows any Vercel domain (*.vercel.app), Render domain (*.onrender.com),
 *   localhost, and 127.0.0.1.
 * - Allows any custom origins in APP_CORS_ORIGINS / FRONTEND_DOMAIN.
 *
 * In Production:
 * - Strictly checks against configured corsOrigins (exact strings or Regex patterns).
 *
 * Requests with no Origin header (e.g. mobile apps, curl, server-to-server, health checks) are always allowed.
 */
export function isCorsOriginAllowed(
  origin: string | undefined,
  corsOrigins: (string | RegExp)[],
  isDev: boolean,
): boolean {
  // 1. Allow requests with no origin (cURL, Postman, mobile apps, health checks)
  if (!origin) {
    return true;
  }

  // 2. If wildcard '*' is explicitly in configured origins
  if (corsOrigins.includes('*')) {
    return true;
  }

  // 3. In Dev / Preview environments, automatically allow Vercel, Render, and Localhost
  if (isDev) {
    const isVercel =
      origin.endsWith('.vercel.app') ||
      /^https:\/\/([a-zA-Z0-9_-]+\.)*vercel\.app$/.test(origin);
    const isRender =
      origin.endsWith('.onrender.com') ||
      /^https:\/\/([a-zA-Z0-9_-]+\.)*onrender\.com$/.test(origin);
    const isLocalhost =
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

    if (isVercel || isRender || isLocalhost) {
      return true;
    }
  }

  // 4. Check explicit configured corsOrigins
  return corsOrigins.some((allowedOrigin) => {
    if (typeof allowedOrigin === 'string') {
      return allowedOrigin === origin;
    }
    if (allowedOrigin instanceof RegExp) {
      return allowedOrigin.test(origin);
    }
    return false;
  });
}
