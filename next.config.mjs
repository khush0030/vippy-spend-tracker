/** @type {import('next').NextConfig} */
const nextConfig = {
  // qpdf ships as an emscripten bundle that loads its own .wasm at runtime;
  // bundling it breaks the loader, so it stays external and is traced by hand.
  // pdfkit reads its standard-font .afm files from disk at runtime, which the
  // tracer cannot see through the bundle; on Vercel that surfaced as ENOENT
  // Helvetica.afm for every harvested email without a PDF attachment.
  serverExternalPackages: ["googleapis", "@jspawn/qpdf-wasm", "pdfkit"],
  outputFileTracingIncludes: {
    "/api/cron/tick": ["./node_modules/@jspawn/qpdf-wasm/**/*", "./node_modules/pdfkit/js/data/**/*"],
    "/api/cron/monthly-report": ["./node_modules/pdfkit/js/data/**/*"],
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
