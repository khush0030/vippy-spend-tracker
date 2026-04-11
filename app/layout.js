import "./globals.css";
import Providers from "./providers";

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
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
