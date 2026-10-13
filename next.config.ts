import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mesmos recursos que o create-next-app 16.4 liga por padrão.
  // O código do projeto funciona com eles ligados ou desligados.
  cacheComponents: true,
  partialPrefetching: true,
  devIndicators: false,
  allowedDevOrigins: ["192.168.100.99", "127.0.0.1"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }, {
      source: "/api/:path*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    }];
  },
};

export default nextConfig;
