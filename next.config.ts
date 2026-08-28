import type { NextConfig } from "next";

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
