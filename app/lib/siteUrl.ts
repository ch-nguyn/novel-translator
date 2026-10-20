// Where the app is served, without a trailing slash (BETTER_AUTH_URL locally,
// the production domain on Vercel); empty when unknown
export const siteOrigin = (
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")
).replace(/\/+$/, "");

export const APP_NAME = "Dịch Truyện Trung";
export const APP_TAGLINE = "Đọc truyện Trung bằng tiếng Việt";
export const APP_DESCRIPTION =
  "Tìm truyện Trung Quốc bằng tên tiếng Việt hoặc dán link chương, rồi đọc bản dịch tiếng Việt mượt mà bằng AI. Có mục lục, tủ truyện, tên riêng, đọc to và cài như ứng dụng.";
