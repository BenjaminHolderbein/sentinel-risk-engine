import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native .node addon; it must not be bundled by
  // webpack/turbopack and its binary + the model/seed files must be traced into
  // the serverless function output.
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/score": ["./public/model/**"],
    "/api/seed": ["./data/**"],
  },
};

export default nextConfig;
