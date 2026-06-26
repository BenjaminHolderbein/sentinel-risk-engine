import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The scoring route reads the compiled tree model + feature spec, and the seed
  // route reads the warm-history file; make sure both are traced into the
  // serverless function bundles. (No native deps — inference is pure TS.)
  outputFileTracingIncludes: {
    "/api/score": ["./public/model/**"],
    "/api/seed": ["./data/**"],
  },
};

export default nextConfig;
