import type { NextConfig } from 'next';

const apiUrl = process.env['API_URL'] ?? 'http://localhost:3001';

/** Same origin in the browser, so the API needs no CORS setup (ADR 0011). */
const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
};

export default nextConfig;
