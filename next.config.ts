import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded from node_modules at runtime rather than bundled: the AMFI cron
  // step reads PDF text through it exactly as it was verified under Node.
  serverExternalPackages: ["unpdf"],
};

export default nextConfig;
