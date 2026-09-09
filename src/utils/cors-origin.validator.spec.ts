import { isCorsOriginAllowed } from './cors-origin.validator';

describe('isCorsOriginAllowed', () => {
  describe('In Development / Dev Branch (isDev = true)', () => {
    const isDev = true;
    const corsOrigins = ['http://localhost:3000', 'https://official-frontend.com'];

    it('should allow requests with no origin header (cURL / Postman / Render health check)', () => {
      expect(isCorsOriginAllowed(undefined, corsOrigins, isDev)).toBe(true);
      expect(isCorsOriginAllowed('', corsOrigins, isDev)).toBe(true);
    });

    it('should allow any Vercel preview domain dynamically', () => {
      expect(
        isCorsOriginAllowed('https://logistics-website-frontend-git-dev-user.vercel.app', corsOrigins, isDev),
      ).toBe(true);
      expect(
        isCorsOriginAllowed('https://logistics-website-frontend-kappa.vercel.app', corsOrigins, isDev),
      ).toBe(true);
      expect(
        isCorsOriginAllowed('https://random-preview-1234.vercel.app', corsOrigins, isDev),
      ).toBe(true);
    });

    it('should allow any Render domain', () => {
      expect(
        isCorsOriginAllowed('https://logistics-website-backend-1.onrender.com', corsOrigins, isDev),
      ).toBe(true);
    });

    it('should allow localhost on any port', () => {
      expect(isCorsOriginAllowed('http://localhost:3000', corsOrigins, isDev)).toBe(true);
      expect(isCorsOriginAllowed('http://localhost:3001', corsOrigins, isDev)).toBe(true);
      expect(isCorsOriginAllowed('http://127.0.0.1:3000', corsOrigins, isDev)).toBe(true);
      expect(isCorsOriginAllowed('http://127.0.0.1:8080', corsOrigins, isDev)).toBe(true);
    });

    it('should allow explicitly configured origins in list', () => {
      expect(isCorsOriginAllowed('https://official-frontend.com', corsOrigins, isDev)).toBe(true);
    });

    it('should allow everything if wildcard "*" is configured', () => {
      expect(isCorsOriginAllowed('https://some-other-site.com', ['*'], isDev)).toBe(true);
    });

    it('should reject unauthorized third-party origins in dev mode if not vercel/render/localhost/configured', () => {
      expect(isCorsOriginAllowed('https://malicious-website.com', corsOrigins, isDev)).toBe(false);
      expect(isCorsOriginAllowed('https://evil-attacker.org', corsOrigins, isDev)).toBe(false);
    });
  });

  describe('In Production Mode (isDev = false)', () => {
    const isDev = false;
    const corsOrigins = [
      'https://logistics-spider.vn',
      new RegExp('^https://.*\\.spider-express\\.vn$'),
    ];

    it('should allow requests with no origin header (cURL / server-to-server)', () => {
      expect(isCorsOriginAllowed(undefined, corsOrigins, isDev)).toBe(true);
    });

    it('should strictly allow only configured production domains', () => {
      expect(isCorsOriginAllowed('https://logistics-spider.vn', corsOrigins, isDev)).toBe(true);
      expect(isCorsOriginAllowed('https://app.spider-express.vn', corsOrigins, isDev)).toBe(true);
    });

    it('should REJECT random vercel preview domains in production mode', () => {
      expect(
        isCorsOriginAllowed('https://logistics-website-frontend-git-dev-user.vercel.app', corsOrigins, isDev),
      ).toBe(false);
      expect(
        isCorsOriginAllowed('https://logistics-website-frontend-kappa.vercel.app', corsOrigins, isDev),
      ).toBe(false);
    });

    it('should REJECT localhost in production mode unless explicitly configured', () => {
      expect(isCorsOriginAllowed('http://localhost:3000', corsOrigins, isDev)).toBe(false);
      expect(isCorsOriginAllowed('http://127.0.0.1:3000', corsOrigins, isDev)).toBe(false);
    });

    it('should REJECT unauthorized external domains in production mode', () => {
      expect(isCorsOriginAllowed('https://malicious-website.com', corsOrigins, isDev)).toBe(false);
    });
  });
});
