import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

/* Why no-undef is switched on explicitly.
 *
 * eslint-config-next leaves `no-undef` OFF, because it assumes TypeScript is doing that
 * job. This project is JavaScript, so nothing was doing that job — and a bare `T.` typo
 * in the dashboard shipped straight past lint AND past `next build` (Turbopack does not
 * resolve identifiers in client components at build time) and only exploded in the
 * browser, at render, as "Uncaught ReferenceError: T is not defined" — a blank page.
 *
 * A blank dashboard in front of RBL is the single worst outcome this repo has. So the
 * one rule that would have caught it statically is now on, everywhere.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["warn", { args: "none", varsIgnorePattern: "^_" }],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
