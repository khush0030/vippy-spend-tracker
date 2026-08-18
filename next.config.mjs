/** @type {import('next').NextConfig} */
const nextConfig = {
  // qpdf ships as an emscripten bundle that loads its own .wasm at runtime;
  // bundling it breaks the loader, so it stays external and is traced by hand.
  serverExternalPackages: ["googleapis", "@jspawn/qpdf-wasm"],
  outputFileTracingIncludes: {
    "/api/cron/tick": ["./node_modules/@jspawn/qpdf-wasm/**/*"],
    "/api/statements": ["./node_modules/@jspawn/qpdf-wasm/**/*"],
  },
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
