import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.RELAY_OWNER_TEST_BUILD === "true" ? ".next-owner-tests" : ".next",
  outputFileTracingRoot: process.cwd(),
  devIndicators: false,
};

export default nextConfig;
