import { ImageResponse } from "next/og";
import AppIcon from "./components/AppIcon";

// The icon an iPhone/iPad puts on the home screen
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<AppIcon size={180} padding={0.14} />, size);
}
