import { STORY_SAFE, WHATSAPP_CONTACT_LABEL, type AdDesignSpec } from "./design";
import type { ShapedText } from "./shaped-text";

// The ad overlay as plain React (#387): the server rasterises it with Satori (render.tsx),
// and the editor draws it in the browser for an instant preview. Keep it free of server imports.

/** On-image words keyed by where they're drawn; values in Devanagari or Gurmukhi get pre-shaped. */
export type ShapedWords = Partial<Record<string, ShapedText>>;

export function adMetrics(spec: AdDesignSpec) {
  // Scale every dimension to the canvas so all formats stay balanced.
  const s = spec.width / 1080;
  const pad = Math.round(Math.min(64 * s, spec.height * 0.06));
  const ctaSize = Math.round(30 * s);
  return {
    s,
    pad,
    contentWidth: spec.width - pad * 2,
    headlineSize: Math.round((spec.format === "landscape" ? 58 : 76) * s),
    subheadSize: Math.round(34 * s),
    benefitSize: Math.round(30 * s),
    brandSize: Math.round(Math.min(38, Math.max(20, 1500 / Math.max(spec.brandName.length, 1))) * s),
    ctaSize,
    contactSize: Math.min(ctaSize, Math.max(18 * s, 850 * s / Math.max(spec.contactLine?.length ?? 1, 1))),
    phoneSize: Math.round(Math.min(spec.format === "landscape" ? 40 : 52, 760 / Math.max(contactText(spec)?.length ?? 1, 1)) * s),
  };
}

/** #1147: the contact bar's big line: the chat ask for a WhatsApp business, else the number to call. */
function contactText(spec: AdDesignSpec): string | null {
  return spec.contact === "whatsapp" ? WHATSAPP_CONTACT_LABEL : spec.phone;
}

/**
 * #967 (#941 rule 2): long-running local ads put the offer on the picture as a bold strip. A picture line that
 * states one (a ₹ price, "free …", "% off", a flat discount) is drawn that way instead of as a quiet subhead.
 */
const OFFER = /(?:₹|\brs\.?|\binr)\s?\d|\d\s?%\s?off\b|(?<![-‐])\bfree\b|\bflat\s+\d|\bdiscount\b|मुफ़्त|मुफ्त|फ्री|ਮੁਫ਼ਤ|ਮੁਫਤ|ਫ੍ਰੀ/iu;
export function isOfferLine(text: string | null | undefined): boolean {
  return Boolean(text && OFFER.test(text.normalize("NFC")));
}

/** The offer strip's text style, shared with the server's Indic shaping so both measure alike. */
export function offerStripStyle(spec: AdDesignSpec) {
  const { s, subheadSize, contentWidth } = adMetrics(spec);
  const padX = Math.round(18 * s);
  return { size: Math.round(subheadSize * 1.12), weight: 700 as const, color: spec.ctaTextColor, padX, padY: Math.round(10 * s), maxWidth: contentWidth - padX * 2 };
}

function Words({ shaped, children }: { shaped?: ShapedText; children: string }) {
  return shaped ? <img src={shaped.src} alt="" width={shaped.width} height={shaped.height} style={{ width: shaped.width, height: shaped.height }} /> : <>{children}</>;
}

/**
 * The logo tile keeps a 64px height; a wide wordmark gets a wider tile (up to
 * 220px) so it stays legible. Square and tall logos keep the 64px square.
 */
export function logoTileWidth(ratio: number, s: number): number {
  const clamped = Number.isFinite(ratio) && ratio > 0 ? Math.min(220, Math.max(64, ratio * 64)) : 64;
  return Math.round(clamped * s);
}

export function AdComposite({ spec, logoRatio = 1, shaped = {} }: { spec: AdDesignSpec; logoRatio?: number; shaped?: ShapedWords }) {
  const { s, pad, headlineSize, subheadSize, benefitSize, brandSize, ctaSize, contactSize, phoneSize } = adMetrics(spec);
  // Stories and Reels cover the top (profile bar) and bottom (caption, reply box, CTA) with their own UI (#1077).
  const safeTop = spec.format === "story" ? Math.round(spec.height * STORY_SAFE.top) : 0;
  const safeBottom = spec.format === "story" ? Math.round(spec.height * STORY_SAFE.bottom) : 0;
  const contentTop =
    spec.layout === "top"
      ? safeTop + pad + Math.round(96 * s)
      : spec.layout === "center"
        ? Math.round(spec.height * 0.28)
        : undefined;
  const contentBottom = spec.layout === "bottom" ? safeBottom + pad : undefined;
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
          top: safeTop + pad,
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
        <div style={{ display: "flex", fontSize: brandSize, fontWeight: 800, color: "#ffffff", flex: 1, wordBreak: "break-word" }}>
          <Words shaped={shaped.brand}>{spec.brandName}</Words>
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
            display: "flex",
          }}
        >
          <Words shaped={shaped.headline}>{spec.headline}</Words>
        </div>

        {spec.subhead && isOfferLine(spec.subhead) ? (() => {
          const strip = offerStripStyle(spec);
          return (
            <div
              data-offer-strip=""
              style={{
                display: "flex",
                alignSelf: "flex-start",
                maxWidth: spec.width - pad * 2,
                padding: `${strip.padY}px ${strip.padX}px`,
                borderRadius: Math.round(10 * s),
                background: spec.primaryColor,
                color: strip.color,
                fontSize: strip.size,
                fontWeight: strip.weight,
                lineHeight: 1.15,
                wordBreak: "break-word",
              }}
            >
              <Words shaped={shaped.subhead}>{spec.subhead}</Words>
            </div>
          );
        })() : spec.subhead ? (
          <div
            style={{
              fontSize: subheadSize,
              color: "#e2e8f0",
              maxWidth: spec.width - pad * 2,
              display: "flex",
            }}
          >
            <Words shaped={shaped.subhead}>{spec.subhead}</Words>
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
            {spec.benefits.map((benefit, i) => (
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
                  style={{ display: "flex", fontSize: benefitSize, color: "#ffffff", fontWeight: 600 }}
                >
                  <Words shaped={shaped[`benefit:${i}`]}>{benefit}</Words>
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
            {contactText(spec) ? (
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
                    {spec.contact === "whatsapp"
                      // A chat bubble: the campaign opens WhatsApp, so the picture doesn't ask for a call (#1147).
                      ? <path d="M3 21l1.65-4.95A8.5 8.5 0 1 1 8 19.4L3 21z" />
                      : <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />}
                  </svg>
                </div>
                {contactText(spec)}
              </div>
            ) : null}
            {spec.contactLine ? (
              <div style={{ fontSize: contactSize, color: "#cbd5e1", display: "flex", wordBreak: "break-word" }}>
                <Words shaped={shaped.contact}>{spec.contactLine}</Words>
              </div>
            ) : null}
          </div>
          {spec.showCta ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
