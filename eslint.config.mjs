import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        Module: "readonly",
        Log: "readonly",
        document: "readonly",
        console: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        Date: "readonly",
        Object: "readonly",
        JSON: "readonly",
        Math: "readonly",
        Infinity: "readonly",
        parseInt: "readonly",
        Promise: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        fetch: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["node_modules/"],
  },
];
