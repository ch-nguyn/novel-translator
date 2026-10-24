import { digitChapterNumber, tocChapterNumber } from "../../../lib/chapterTitle";
import { hasChinese } from "../../../lib/search";
import { cachedTranslations } from "../../../lib/server/cachedTranslations";
import { helperAi } from "../../../lib/server/helperAi";
import { limitRequest } from "../../../lib/server/rateLimit";

// Chapter titles of a table of contents in Vietnamese, for the part the
// reader is looking at. Cached for every reader (see cachedTranslations).

const MAX_TITLES = 100;
const MAX_TITLE_CHARS = 100;

const TITLES_PROMPT = `Translate each Chinese web novel chapter title into Vietnamese the way Vietnamese translations of xianxia/xuanhuan novels write them: names and terms in Sino-Vietnamese (Hán Việt), the rest in natural Vietnamese. Write the chapter number in digits: 第五百二十三章 剑出 → Chương 523: Kiếm xuất, 第12章 青牛镇 → Chương 12: Thanh Ngưu trấn. Keep Latin letters and digits. No Chinese characters in the answer.
The input is a JSON object of numbered titles. Answer with only a JSON object with the same numbers: {"1":"Chương 523: Kiếm xuất"}.`;

export async function POST(req: Request) {
  const limited = await limitRequest(req, "titles");
  if (limited) return limited;
  let body: { titles?: unknown; apiKey?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const titles = Array.isArray(body?.titles) ? body.titles : null;
  if (!titles || titles.length > MAX_TITLES || !titles.every((t) => typeof t === "string" && t.length <= MAX_TITLE_CHARS)) {
    return Response.json({ error: "Invalid titles" }, { status: 400 });
  }
  const chinese = [...new Set((titles as string[]).filter(hasChinese))];
  const found = await cachedTranslations(chinese, helperAi(req, body?.apiKey), {
    prompt: TITLES_PROMPT,
    cacheKey: (title) => `toc:title:${title}`,
    perCall: 25,
    task: "toc-titles",
  });
  // In digits even when the AI spelled the number out (or did before, in the cache)
  const titled = [...found].map(([title, translated]) => [title, digitChapterNumber(translated, tocChapterNumber(title))]);
  return Response.json({ titles: Object.fromEntries(titled) });
}
