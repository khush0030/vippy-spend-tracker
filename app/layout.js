import "./globals.css";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import Providers from "./providers";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500", "600"],
});

export const metadata = {
  title: "Vippy Spend Tracker",
  description: "HDFC Corporate Card Expense Tracker for Vippy Industries",
  icons: {
    icon: [{ url: "/vippy-logo.webp", type: "image/webp" }],
    shortcut: "/vippy-logo.webp",
    apple: "/vippy-logo.webp",
  },
  openGraph: {
    title: "Vippy Spend Tracker",
    description: "HDFC Corporate Card Expense Tracker for Vippy Industries",
    images: ["/vippy-logo.webp"],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6F7" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1214" },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${manrope.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
