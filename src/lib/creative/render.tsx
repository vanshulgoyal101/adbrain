import { ImageResponse } from "next/og";
import type { AdDesignSpec } from "./design";

/**
 * Rasterise an {@link AdDesignSpec} into a finished poster-style ad using the
 * same Satori/resvg engine that powers our OG image — no extra dependency and
 * no custom font (the bundled sans-serif is used). The AI photo is composited
 * underneath a legibility scrim, with the logo, headline, benefit checklist and
 * a contact/CTA bar laid on top the way a human designer would.
 */
export async function renderCompositeAd(spec: AdDesignSpec): Promise<Uint8Array> {
  const res = new ImageResponse(<AdComposite spec={spec} />, {
    width: spec.width,
    height: spec.height,
  });
  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}

function AdComposite({ spec }: { spec: AdDesignSpec }) {
  // Scale every dimension to the canvas so all formats stay balanced.
  const s = spec.width / 1080;
  const pad = Math.round(64 * s);
  const headlineSize = Math.round((spec.format === "landscape" ? 58 : 76) * s);
  const subheadSize = Math.round(34 * s);
  const benefitSize = Math.round(30 * s);
  const brandSize = Math.round(38 * s);
  const ctaSize = Math.round(30 * s);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",        alignItems: "flex-start",        background: `linear-gradient(135deg, ${spec.primaryColor} 0%, #0f172a 100%)`,
        fontFamily: "sans-serif",
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
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 32%, rgba(0,0,0,0.55) 66%, rgba(0,0,0,0.88) 100%)",
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
        }}
      >
        {spec.logoUrl ? (
          <img
            src={spec.logoUrl}
            alt=""
            width={Math.round(64 * s)}
            height={Math.round(64 * s)}
            style={{
              width: Math.round(64 * s),
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
        <div style={{ fontSize: brandSize, fontWeight: 800, color: "#ffffff" }}>
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
          bottom: pad,
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
          }}
        >
          <div style={{ fontSize: ctaSize, color: "#cbd5e1", display: "flex", overflow: "hidden" }}>
            {spec.contactLine ?? ""}
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
