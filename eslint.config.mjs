import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  { ignores: [".next/**", "node_modules/**", "coverage/**", "playwright-report/**", "next-env.d.ts", "**/*.d.mts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...compat.extends("next/core-web-vitals"),
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
];

export default config;
