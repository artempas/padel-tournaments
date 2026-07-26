import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg'],
  // The Docker build sets BUILD_STANDALONE=1 to emit a self-contained server
  // bundle. Left off locally so plain `npm run build && npm start` keeps working.
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
};

export default nextConfig;
