import type { Metadata } from "next";
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
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
