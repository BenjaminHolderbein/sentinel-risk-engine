import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native .node addon; it must not be bundled by
  // webpack/turbopack and its binary + the model/seed files must be traced into
  // the serverless function output.
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingIncludes: {
    // The tracer follows the onnxruntime-node .node addon but misses its
    // libonnxruntime.so sidecar, so force-include the native binaries along with
    // the model + seed files the API routes read at runtime.
    "/api/**": [
      "./public/model/**",
      "./data/**",
      "./node_modules/onnxruntime-node/bin/**",
    ],
  },
};

export default nextConfig;
