// Chapter numbers in chapter titles: as the sites write them (Chinese), and
// in digits in the Vietnamese ones, which the AI sometimes spells out
// (Chương hai nghìn không trăm tám mươi tư). Shared by the server and the browser.

const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const UNITS: Record<string, number> = { 十: 10, 拾: 10, 百: 100, 佰: 100, 千: 1000, 仟: 1000 };

// 五百二十三 → 523, 一零二 → 102, 十二 → 12
export function parseChineseNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return parseInt(text, 10);
  if (![...text].every((c) => c in DIGITS || c in UNITS || c === "万" || c === "萬")) return null;
  // Written digit by digit, without units
  if (![...text].some((c) => c in UNITS || c === "万" || c === "萬")) {
    return parseInt([...text].map((c) => DIGITS[c]).join(""), 10);
  }
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const c of text) {
    if (c in DIGITS) digit = DIGITS[c];
    else if (c in UNITS) {
      section += (digit || 1) * UNITS[c];
      digit = 0;
    } else {
      total += (section + digit) * 10000;
      section = 0;
      digit = 0;
    }
  }
  return total + section + digit;
}

const CHINESE_CHAPTER = /第\s*([0-9零〇一二两兩三四五六七八九十拾百佰千仟万萬]+)\s*([章节節回话話])/;

// The chapter number in a site's title: 第五百二十三章 剑出 → 523, 第12章 → 12
export function tocChapterNumber(title: string): number | null {
  const match = title.match(CHINESE_CHAPTER);
  return match ? parseChineseNumber(match[1]) : null;
}

// A site's title with its chapter number in digits, for the AI to keep:
// 第二千零八十四章 都在行动 → 第2084章 都在行动
export function digitChineseChapterNumber(title: string): string {
  return title.replace(CHINESE_CHAPTER, (whole, number: string, unit: string) => {
    const value = parseChineseNumber(number);
    return value === null ? whole : `第${value}${unit}`;
  });
}

const VI_DIGITS: Record<string, number> = {
  không: 0, một: 1, mốt: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, lăm: 5, nhăm: 5, sáu: 6, bảy: 7, bẩy: 7, tám: 8, chín: 9,
};
// Between hundreds and units: một trăm linh ba → 103
const VI_ZERO = new Set(["linh", "lẻ"]);

// The values of the number spelled out by the first `words`, each prefix that
// is one (hai nghìn không trăm tám mươi tư → …, 2084 for all four)
function vietnameseNumbers(words: string[]): number[] {
  const values: number[] = [];
  let total = 0;
  let section = 0;
  let digit: number | null = null;
  for (const raw of words) {
    const word = raw.toLowerCase();
    if (word in VI_DIGITS) {
      // Two digits in a row: the second is the title's
      if (digit !== null) break;
      digit = VI_DIGITS[word];
    } else if (VI_ZERO.has(word)) {
      if (digit !== null) break;
    } else if (word === "mười") {
      if (digit !== null) break;
      section += 10;
    } else if (word === "mươi") {
      if (digit === null) break;
      section += digit * 10;
      digit = null;
    } else if (word === "trăm") {
      section += (digit ?? 1) * 100;
      digit = null;
    } else if (word === "nghìn" || word === "ngàn") {
      total += (section + (digit ?? (section ? 0 : 1))) * 1000;
      section = 0;
      digit = null;
    } else if (word === "vạn") {
      total += (section + (digit ?? (section ? 0 : 1))) * 10000;
      section = 0;
      digit = null;
    } else break;
    values.push(total + section + (digit ?? 0));
  }
  return values;
}

// The title's first "Chương", and the words after it
const SPELLED_CHAPTER = /^(.*?)(Chương)\s+(?:thứ\s+)?(\p{L}+(?:\s+\p{L}+)*)/iu;

// A Vietnamese title with its chapter number in digits: Chương thứ hai nghìn
// không trăm tám mươi mốt - Ma tu → Chương 2081 - Ma tu. `number`: the one
// the site's title has, when known (the title's words after it are told apart by it).
export function digitChapterNumber(title: string, number?: number | null): string {
  const match = title.match(SPELLED_CHAPTER);
  if (!match || /chương/i.test(match[1])) return title;
  const words = match[3].split(/\s+/);
  const values = vietnameseNumbers(words);
  if (values.length === 0) return title;
  let count = values.length;
  if (number != null) {
    const exact = values.lastIndexOf(number);
    if (exact >= 0) count = exact + 1;
  }
  const spelled = new RegExp(`^${words.slice(0, count).join("\\s+")}`, "u");
  const rest = title.slice(match[0].length - match[3].length).replace(spelled, "");
  return `${match[1]}${match[2]} ${values[count - 1]}${rest}`;
}
