import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdBrain — AI ads for solar businesses",
  description:
    "Fill your brand brain, type a goal, and get on-brand solar ad creatives ready to launch.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* Unified usage analytics (privacy-friendly, no cookies) */}
        <Script src="https://vanshul.com/a.js" data-site="adbrain" strategy="afterInteractive" />
      </body>
    </html>
  );
}
