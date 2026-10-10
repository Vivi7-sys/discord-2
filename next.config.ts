import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mesmos recursos que o create-next-app 16.4 liga por padrão.
  // O código do projeto funciona com eles ligados ou desligados.
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: false,
  allowedDevOrigins: ["192.168.100.99", "127.0.0.1"],
};

export default nextConfig;
