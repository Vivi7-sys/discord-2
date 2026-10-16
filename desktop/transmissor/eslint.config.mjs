import { defineConfig } from "eslint/config";
import base from "../../eslint.config.mjs";

export default defineConfig([
  ...base,
  { files: ["**/*.cjs", "**/*.mjs"], rules: { "@next/next/no-html-link-for-pages": "off" } },
]);
