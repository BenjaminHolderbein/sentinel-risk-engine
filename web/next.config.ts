import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native .node addon; it must not be bundled by
  // webpack/turbopack and its binary + the model/seed files must be traced into
  // the serverless function output.
  serverExternalPackages: ["onnxruntime-node"],
  outputFileTracingIncludes: {
    // The tracer follows the onnxruntime-node .node addon but misses its
    // libonnxruntime.so sidecar. Force-include ONLY the linux/x64 native files
    // (Vercel's runtime) plus the model — scoped to /api/score so the other
    // functions stay small and we don't bundle every platform's binaries.
    "/api/score": [
      "./public/model/**",
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**",
    ],
    "/api/seed": ["./data/**"],
  },
};

export default nextConfig;
