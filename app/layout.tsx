import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novel Translator",
  description: "Translate and simplify novels for easy reading",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body className="bg-gray-50 text-gray-900 min-h-screen">{children}</body>
    </html>
  );
}
