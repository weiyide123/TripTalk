import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // This project has its own lockfile; never infer the parent demo as its root.
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    "/*": ["./src/server/storage/migrations/*.sql"],
  },
  poweredByHeader: false,
  agentRules: false, // Preserve the project's hand-maintained AGENTS.md.
};

export default nextConfig;
