// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/explicit-function-return-type": "warn",
      complexity: ["error", 10],
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "evals/results/**", "*.js", "*.mjs"],
  },
);
