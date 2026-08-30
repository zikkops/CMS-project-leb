import type { NextConfig } from "next";
// One .env.local at the repo root feeds all three apps — see env.mjs. Called
// here rather than anywhere else because NEXT_PUBLIC_* values are inlined at
// compile time, and next.config is what runs before compilation.
import { loadRootEnv } from "../env.mjs";

loadRootEnv();

const nextConfig: NextConfig = {
  // firebase-admin must not be bundled. It resolves optional native/gRPC
  // dependencies at runtime and reads a PEM private key — bundling it produces
  // either a build-time resolution error or a runtime failure that only shows
  // up on the deployed function, never locally. Listing it here tells Next.js
  // to leave it as a plain require() from node_modules on the server.
  //
  // This is also a load-bearing guard: it applies to SERVER bundles only, so
  // if firebase-admin ever gets imported from a client component by mistake,
  // the build fails loudly instead of quietly shipping the Admin SDK — and the
  // credential handling around it — to a browser.
  serverExternalPackages: ['firebase-admin'],
  // @big-cms/shared ships TypeScript source with no build step, so Next has to
  // compile it as if it were part of this app. One source of truth, and no
  // watch process each app has to remember to start.
  transpilePackages: ['@big-cms/shared'],
  // Emits a self-contained folder at .next/standalone — the app plus only the
  // node_modules it actually uses. Without this, deploying this folder alone
  // gives an app with no dependencies, because a workspace hoists them to the
  // repo root. This is what makes each app genuinely "copy it and run it".
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ibb.co',
      },
      // Demo placeholder photography. Must stay in step with the CSP's img-src
      // in proxy.ts — allowing a host in only one of the two places fails
      // silently rather than erroring.
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
      {
        protocol: 'https',
        hostname: 'api.dicebear.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Stops this site being framed by another origin (clickjacking) —
          // relevant for /admin/login and /customer/login especially.
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stops the browser from MIME-sniffing a response into something
          // other than its declared Content-Type.
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Full URL (incl. query params) is sent on same-origin navigation,
          // only the origin (no path/query) leaks to a different origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // This app never uses the camera, mic, or geolocation — deny all
          // three outright rather than leaving them at the browser default.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
};

export default nextConfig;
