import { ImageResponse } from "next/og";
import { siteConfig } from "@/lib/site";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share card rendered at build time. */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #ecfdf5 0%, #ffffff 55%, #d1fae5 100%)",
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background: "#059669",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
            }}
          >
            ☀
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, color: "#0f172a" }}>
            {siteConfig.name}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 800,
              lineHeight: 1.05,
              color: "#0f172a",
              maxWidth: 900,
            }}
          >
            AI ad creative for any local business
          </div>
          <div style={{ fontSize: 32, color: "#475569", maxWidth: 880 }}>
            Fill your brand brain, type a goal, and get on-brand ads ready to launch.
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px" }}>
          {["Brand Brain", "Creative Studio", "One-click Meta launch"].map((t) => (
            <div
              key={t}
              style={{
                fontSize: 26,
                color: "#047857",
                background: "#ffffff",
                border: "2px solid #a7f3d0",
                borderRadius: 999,
                padding: "10px 24px",
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
