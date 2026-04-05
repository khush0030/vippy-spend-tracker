/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["googleapis"],
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;
