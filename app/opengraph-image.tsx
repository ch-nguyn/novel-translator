import { ImageResponse } from "next/og";
import AppIcon from "./components/AppIcon";
import { APP_NAME, APP_TAGLINE } from "./lib/siteUrl";

// The picture of a link to the app shared on Facebook, Zalo…
export const alt = `${APP_NAME} – ${APP_TAGLINE}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", gap: 56, padding: "0 80px", background: "#f5f5dc", color: "#1f2937" }}>
        <div style={{ display: "flex", borderRadius: 48, overflow: "hidden", boxShadow: "0 12px 40px rgba(0,0,0,0.12)" }}>
          <AppIcon size={260} padding={0.12} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, flex: 1 }}>
          <div style={{ fontSize: 68, lineHeight: 1.1 }}>{APP_NAME}</div>
          <div style={{ fontSize: 40, color: "#4b5563", lineHeight: 1.25 }}>{APP_TAGLINE}</div>
          <div style={{ fontSize: 26, color: "#2563eb", marginTop: 12 }}>Tìm truyện · Dịch bằng AI · Đọc to · Cài như ứng dụng</div>
        </div>
      </div>
    ),
    size
  );
}
