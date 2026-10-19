import { ImageResponse } from "next/og";
import AppIcon from "../../components/AppIcon";

// The installed app's icons (app/manifest.ts); "maskable" leaves the margin
// Android may crop to its icon shape
const SIZES: Record<string, { size: number; maskable: boolean }> = {
  "192": { size: 192, maskable: false },
  "512": { size: 512, maskable: false },
  maskable: { size: 512, maskable: true },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(SIZES).map((size) => ({ size }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ size: string }> }) {
  const icon = SIZES[(await params).size];
  if (!icon) return new Response("Not found", { status: 404 });
  return new ImageResponse(<AppIcon size={icon.size} padding={icon.maskable ? 0.2 : 0.12} />, { width: icon.size, height: icon.size });
}
