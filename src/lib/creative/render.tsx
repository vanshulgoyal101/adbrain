import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import type { AdDesignSpec } from "./design";
import { downloadImage } from "@/lib/imageGen";

/**
 * Rasterise an {@link AdDesignSpec} into a finished poster-style ad using the
 * same Satori/resvg engine that powers our OG image, with Inter (OFL, in
 * ./fonts) in real 400–800 weights so headlines are bold. The AI photo is composited
 * underneath a legibility scrim, with the logo, headline, benefit checklist and
 * a contact/CTA bar laid on top the way a human designer would.
 */
export async function renderCompositeAd(spec: AdDesignSpec): Promise<Uint8Array> {
  let logoRatio = 1;
  const [backgroundUrl, logoUrl] = await Promise.all(
    [spec.backgroundUrl, spec.logoUrl].map(async (url) => {
      if (!url) return null;
      const image = await downloadImage(url);
      if (url === spec.logoUrl) logoRatio = await aspectRatio(image.bytes);
      return `data:image/png;base64,${Buffer.from(image.bytes).toString("base64")}`;
    }),
  );
  return rasterize(<AdComposite spec={{ ...spec, backgroundUrl, logoUrl }} logoRatio={logoRatio} />, { width: spec.width, height: spec.height });
}

const FONT_DIR = path.join(process.cwd(), "src/lib/creative/fonts");
const FONT_FILES = [[400, "Regular"], [600, "SemiBold"], [700, "Bold"], [800, "ExtraBold"]] as const;
type AdFont = { name: string; data: Buffer; weight: (typeof FONT_FILES)[number][0]; style: "normal" };
let adFonts: AdFont[] | undefined;

/**
 * Every family in a spec (the brand picker's sans-serif, serif, monospace) falls back to Inter,
 * the only font loaded, so all ads get real weights. Read once per server instance.
 */
function loadAdFonts(): AdFont[] {
  adFonts ??= FONT_FILES.map(([weight, file]) => ({ name: "Inter", data: readFileSync(path.join(FONT_DIR, `Inter-${file}.ttf`)), weight, style: "normal" }));
  return adFonts;
}

export async function rasterize(element: ReactElement, size: { width: number; height: number }): Promise<Uint8Array> {
  const res = new ImageResponse(element, { ...size, fonts: loadAdFonts() });
  return new Uint8Array(await res.arrayBuffer());
}

/** Width over height of an image, or 1 (square) when it can't be read. */
async function aspectRatio(bytes: Uint8Array): Promise<number> {
  try {
    const { width, height } = await sharp(Buffer.from(bytes)).metadata();
    return width && height ? width / height : 1;
  } catch {
    return 1;
  }
}

/**
 * The logo tile keeps a 64px height; a wide wordmark gets a wider tile (up to
 * 220px) so it stays legible. Square and tall logos keep the 64px square.
 */
export function logoTileWidth(ratio: number, s: number): number {
  const clamped = Number.isFinite(ratio) && ratio > 0 ? Math.min(220, Math.max(64, ratio * 64)) : 64;
  return Math.round(clamped * s);
}

export function AdComposite({ spec, logoRatio = 1 }: { spec: AdDesignSpec; logoRatio?: number }) {
  // Scale every dimension to the canvas so all formats stay balanced.
  const s = spec.width / 1080;
  const pad = Math.round(Math.min(64 * s, spec.height * 0.06));
  const headlineSize = Math.round((spec.format === "landscape" ? 58 : 76) * s);
  const subheadSize = Math.round(34 * s);
  const benefitSize = Math.round(30 * s);
  const brandSize = Math.round(Math.min(38, Math.max(20, 1500 / Math.max(spec.brandName.length, 1))) * s);
  const ctaSize = Math.round(30 * s);
  const phoneSize = Math.round(Math.min(spec.format === "landscape" ? 40 : 52, 760 / Math.max(spec.phone?.length ?? 1, 1)) * s);
  const contentTop =
    spec.layout === "top"
      ? pad + Math.round(96 * s)
      : spec.layout === "center"
        ? Math.round(spec.height * 0.28)
        : undefined;
  const contentBottom = spec.layout === "bottom" ? pad : undefined;
  const scrim =
    spec.layout === "top"
      ? "linear-gradient(180deg, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.52) 34%, rgba(0,0,0,0.08) 72%, rgba(0,0,0,0.24) 100%)"
      : spec.layout === "center"
        ? "linear-gradient(90deg, rgba(0,0,0,0.76) 0%, rgba(0,0,0,0.36) 52%, rgba(0,0,0,0.16) 100%)"
        : "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.55) 66%, rgba(0,0,0,0.88) 100%)";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        alignItems: "flex-start",
        background: spec.primaryColor,
        fontFamily: spec.fontFamily,
        overflow: "hidden",
      }}
    >
      {spec.backgroundUrl ? (
        <img
          src={spec.backgroundUrl}
          alt=""
          width={spec.width}
          height={spec.height}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : null}

      {/* Legibility scrim: dark at the bottom where the copy sits. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          background: scrim,
        }}
      />

      {/* Brand lockup, top-left. */}
      <div
        style={{
          position: "absolute",
          top: pad,
          left: pad,
          display: "flex",
          alignItems: "center",
          gap: Math.round(18 * s),
          width: spec.width - pad * 2,
        }}
      >
        {spec.logoUrl ? (
          <img
            src={spec.logoUrl}
            alt=""
            width={logoTileWidth(logoRatio, s)}
            height={Math.round(64 * s)}
            style={{
              width: logoTileWidth(logoRatio, s),
              height: Math.round(64 * s),
              borderRadius: Math.round(14 * s),
              objectFit: "contain",
              background: "#ffffff",
            }}
          />
        ) : (
          <div
            style={{
              width: Math.round(64 * s),
              height: Math.round(64 * s),
              borderRadius: Math.round(14 * s),
              background: spec.primaryColor,
              color: spec.ctaTextColor,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: Math.round(36 * s),
              fontWeight: 800,
            }}
          >
            {spec.brandName.charAt(0).toUpperCase()}
          </div>
        )}
        <div style={{ fontSize: brandSize, fontWeight: 800, color: "#ffffff", flex: 1, wordBreak: "break-word" }}>
          {spec.brandName}
        </div>
      </div>

      {/* Headline + subhead + benefits + contact/CTA, bottom-aligned.
          Absolutely positioned with an explicit width so the box never exceeds
          the canvas — Satori ignores `right` when `left` is set and stretches a
          flex child to full width, which pushes the CTA off the right edge. */}
      <div
        style={{
          position: "absolute",
          left: pad,
          ...(contentTop !== undefined ? { top: contentTop } : {}),
          ...(contentBottom !== undefined ? { bottom: contentBottom } : {}),
          width: spec.width - pad * 2,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(20 * s),
        }}
      >
        <div
          style={{
            fontSize: headlineSize,
            fontWeight: 800,
            color: "#ffffff",
            lineHeight: 1.05,
            maxWidth: spec.width - pad * 2,
            wordBreak: "break-word",
          }}
        >
          {spec.headline}
        </div>

        {spec.subhead ? (
          <div
            style={{
              fontSize: subheadSize,
              color: "#e2e8f0",
              maxWidth: spec.width - pad * 2,
            }}
          >
            {spec.subhead}
          </div>
        ) : null}

        {spec.benefits.length ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: Math.round(14 * s),
              marginTop: Math.round(4 * s),
            }}
          >
            {spec.benefits.map((benefit) => (
              <div
                key={benefit}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: Math.round(10 * s),
                  background: "rgba(255,255,255,0.14)",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: 999,
                  padding: `${Math.round(10 * s)}px ${Math.round(18 * s)}px`,
                }}
              >
                <div
                  style={{
                    width: Math.round(26 * s),
                    height: Math.round(26 * s),
                    borderRadius: 999,
                    background: spec.primaryColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {/* Drawn checkmark — avoids a runtime web-font fetch for the ✓ glyph. */}
                  <svg
                    width={Math.round(15 * s)}
                    height={Math.round(15 * s)}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={spec.ctaTextColor}
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="5 13 10 18 19 6" />
                  </svg>
                </div>
                <div
                  style={{ fontSize: benefitSize, color: "#ffffff", fontWeight: 600 }}
                >
                  {benefit}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: Math.round(12 * s),
            gap: Math.round(20 * s),
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: Math.round(8 * s) }}>
            {spec.phone ? (
              <div style={{ display: "flex", alignItems: "center", gap: Math.round(14 * s), fontSize: phoneSize, fontWeight: 800, color: "#ffffff", lineHeight: 1 }}>
                <div
                  style={{
                    width: Math.round(phoneSize * 1.1),
                    height: Math.round(phoneSize * 1.1),
                    borderRadius: 999,
                    background: spec.primaryColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width={Math.round(phoneSize * 0.6)}
                    height={Math.round(phoneSize * 0.6)}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={spec.ctaTextColor}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
                {spec.phone}
              </div>
            ) : null}
            {spec.contactLine ? (
              <div style={{ fontSize: Math.min(ctaSize, Math.max(18 * s, 850 * s / Math.max(spec.contactLine.length, 1))), color: "#cbd5e1", display: "flex", wordBreak: "break-word" }}>
                {spec.contactLine}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              flexShrink: 0,
              fontSize: ctaSize,
              fontWeight: 700,
              color: spec.ctaTextColor,
              background: spec.primaryColor,
              borderRadius: 999,
              padding: `${Math.round(14 * s)}px ${Math.round(28 * s)}px`,
            }}
          >
            {spec.ctaLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
