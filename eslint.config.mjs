import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local-only, untracked folders: session worktrees (full repo copies),
    // one-off scripts and standalone data/analysis projects.
    ".claude/**",
    "scratch/**",
    "backtesting/**",
    "crosscheck/**",
    "3 Year AMFI Data/**",
    "Ambit AMC/**",
  ]),
]);

export default eslintConfig;
