import "./globals.css";
import { Plus_Jakarta_Sans, DM_Sans } from "next/font/google";
import Providers from "./providers";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["400", "500", "600", "700", "800"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm",
  weight: ["400", "500", "600", "700"],
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
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${dmSans.variable}`}>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
