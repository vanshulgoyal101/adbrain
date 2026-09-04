import type { Metadata } from "next";
import Script from "next/script";
import { JsonLd } from "@/components/json-ld";
import { marketingGraph } from "@/lib/seo/jsonLd";
import { siteConfig } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — ${siteConfig.tagline}`,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [...siteConfig.keywords],
  authors: [{ name: siteConfig.author }],
  creator: siteConfig.author,
  publisher: siteConfig.name,
  category: "technology",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.description,
    url: siteConfig.url,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — ${siteConfig.tagline}`,
    description: siteConfig.shortDescription,
    creator: siteConfig.twitter,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    // .ico first for surfaces that only understand it, SVG for everything modern.
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};

export const viewport = {
  themeColor: "#2563eb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <link rel="preconnect" href="https://vanshul.com" />
        <link rel="dns-prefetch" href="https://vanshul.com" />
      </head>
      <body className="min-h-full flex flex-col">
        <JsonLd data={marketingGraph()} />
        {children}
        {/* Unified usage analytics (privacy-friendly, no cookies) */}
        <Script src="https://vanshul.com/a.js" data-site="adbrain" strategy="afterInteractive" />
      </body>
    </html>
  );
}
