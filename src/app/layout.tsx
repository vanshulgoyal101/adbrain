import type { Metadata } from "next";
import Script from "next/script";
import { marketingGraph } from "@/lib/seo/jsonLd";
import { siteConfig } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: `${siteConfig.name} — AI ads for solar businesses`,
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
    title: `${siteConfig.name} — AI ads for solar businesses`,
    description: siteConfig.description,
    url: siteConfig.url,
    locale: siteConfig.locale,
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteConfig.name} — AI ads for solar businesses`,
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
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/icon.svg",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport = {
  themeColor: "#059669",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          // Structured data for search engines (Organization, WebSite, App).
          dangerouslySetInnerHTML={{ __html: JSON.stringify(marketingGraph()) }}
        />
        {children}
        {/* Unified usage analytics (privacy-friendly, no cookies) */}
        <Script src="https://vanshul.com/a.js" data-site="adbrain" strategy="afterInteractive" />
      </body>
    </html>
  );
}
