import "./globals.css";

export const metadata = {
  title: "Vippy Spend Tracker",
  description: "HDFC Corporate Card Expense Tracker for Vippy Industries",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
