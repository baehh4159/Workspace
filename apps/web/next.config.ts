import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@workspace/core', '@workspace/ai'],
};

export default nextConfig;
