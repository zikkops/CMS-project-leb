import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Three Next apps live in one repo. Without this the Next plugin looks for a
  // pages/ folder at the repo root and warns on every run.
  { settings: { next: { rootDir: ["web/", "admin/", "pos/"] } } },
  // Pictures are plain <img> on purpose. They are remote (imgbb, the media
  // library), and the till also runs on a café hub with no internet, where
  // next/image would send every picture through the hub's own server to be
  // fetched and resized. A plain <img> costs the hub nothing when it fails.
  { rules: { "@next/next/no-img-element": "off" } },
  // A name starting with _ is unused on purpose (a parameter kept for its
  // position, a field dropped from a copy); so is one left out of {...rest}.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true,
      }],
    },
  },
  // The Windows counter app (Electron's main process and preload) is CommonJS,
  // as Electron loads it; require() is how those files import.
  { files: ["desktop/*.js"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "**/.next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "**/next-env.d.ts",
    // Build output and bundled copies: packaged apps (dist/), the hub server
    // the counter app ships (desktop/hub-bundle), the installer's unpacked app,
    // the phone app's generated bundle and native project. Linting them took
    // lint past ten minutes and says nothing about the source.
    "dist/**",
    "desktop/node_modules/**",
    "desktop/dist/**",
    "desktop/hub-bundle/**",
    "phone/node_modules/**",
    "phone/android/**",
    "phone/www/app.js",
    // Local data, never code.
    ".hub/**",
    "backups/**",
    ".scratch/**",
    ".tmp-verify/**",
  ]),
]);

export default eslintConfig;
