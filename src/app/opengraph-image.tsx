import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { siteConfig } from "@/lib/site";

export const alt = `${siteConfig.name} — ${siteConfig.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Social share card rendered at build time. */
export default async function OpengraphImage() {
  const icon = await readFile(join(process.cwd(), "public/icon-192.png"));
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 55%, #dbeafe 100%)",
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
              background: "#2563eb",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              color: "#ffffff",
              fontWeight: 800,
            }}
          >
            <img src={`data:image/png;base64,${icon.toString("base64")}`} alt="" width={72} height={72} />
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
            Marketing for your next customer.
          </div>
          <div style={{ fontSize: 32, color: "#475569", maxWidth: 880 }}>
            Your brand. Your message. Your next campaign.
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px" }}>
          {["Create", "Review", "Reach customers"].map((t) => (
            <div
              key={t}
              style={{
                fontSize: 26,
                color: "#1d4ed8",
                background: "#ffffff",
                border: "2px solid #bfdbfe",
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
