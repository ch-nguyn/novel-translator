import * as cheerio from "cheerio";

// TEMPORARY: checks from Vercel's servers whether candidate novel sites can be
// read with a plain fetch. Fixed list only (no user input). Remove after use.

export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface Probe {
  url: string;
  // Where the story text (or the results) should be
  selector?: string;
  encoding?: string;
}

const PROBES: Record<string, Probe[]> = {
  "biquuge.com": [
    { url: "https://www.biquuge.com/0/229/245181.html", selector: "article" },
    { url: "https://www.biquuge.com/search.php?q=%E9%81%AE%E5%A4%A9", selector: "dl" },
  ],
  "ixdzs.tw": [{ url: "https://ixdzs.tw/read/46710/p1.html", selector: "article.page-content" }],
  "biquge7.xyz": [
    { url: "https://www.biquge7.xyz/52408", selector: ".list ul a" },
    { url: "https://www.biquge7.xyz/52408/1", selector: "div.text" },
    { url: "https://www.biquge7.xyz/search?keyword=%E9%81%AE%E5%A4%A9", selector: ".tui_1_item" },
  ],
  "xbanxia.cc": [
    { url: "https://www.xbanxia.cc/books/53578.html", selector: "#content-list .book-list a" },
    { url: "https://www.xbanxia.cc/books/53578/25041601.html", selector: "#nr1" },
    { url: "https://www.xbanxia.cc/modules/article/search_t.php?searchkey=%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E5%82%B3", selector: "li.pop-book2" },
  ],
  "twkan.cc": [
    { url: "https://www.twkan.cc/book/6xWidisB72Uwxqaddk1PxZ.html", selector: "body" },
    { url: "https://www.twkan.cc/chapter/6xWidisB72Uwxqaddk1PxZ.html", selector: "#allchapter dd a" },
    { url: "https://www.twkan.cc/chapter/6xWidisB72Uwxqaddk1PxZ/3NbW6jms2oFnYcmaLKFhe4.html", selector: "#content" },
    { url: "https://www.twkan.cc/search/%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E5%82%B3.html", selector: ".bookbox" },
  ],
  "biquge520.net": [
    { url: "https://www.biquge520.net/107/107228/", selector: ".book_list2 li a" },
    { url: "https://www.biquge520.net/107/107228/360574.html", selector: "article" },
    { url: "https://www.biquge520.net/search.php?q=%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E4%BC%A0", selector: "dl" },
  ],
  "piaotia.com": [
    { url: "https://www.piaotia.com/html/15/15678/", selector: "li a", encoding: "gbk" },
    { url: "https://www.piaotia.com/html/15/15678/13132376.html", selector: "body", encoding: "gbk" },
    { url: "https://www.piaotia.com/modules/article/search.php?searchtype=articlename&searchkey=%D5%DA%CC%EC", selector: "body", encoding: "gbk" },
  ],
  "quanben.io": [
    { url: "https://big5.quanben.io/n/fanrenxiuxianzhuan/list.html", selector: "a" },
    { url: "https://big5.quanben.io/n/fanrenxiuxianzhuan/1.html", selector: "#content" },
    { url: "https://big5.quanben.io/index.php?c=book&a=search&keywords=%E5%87%A1%E4%BA%BA%E4%BF%AE%E4%BB%99%E5%82%B3", selector: ".list2" },
  ],
  "sto66.com": [
    { url: "https://www.sto66.com/chapter/16ABo1xDXh4nyeBPyapArh/6oV9gPyfQBj3Hoic97Xjdf.html", selector: "#content" },
    { url: "https://www.sto66.com/search/%E5%A4%9C%E7%84%A1%E7%96%86.html", selector: ".bookbox" },
  ],
  "biquge345.com": [{ url: "https://www.biquge345.com/chapter/751802/342967201.html", selector: "#txt" }],
  // Blocked from Vietnam: maybe not from Vercel
  "69shuba.com": [{ url: "https://www.69shuba.com/" }],
  "czbooks.net": [{ url: "https://czbooks.net/" }],
  "hetushu.com": [{ url: "https://www.hetushu.com/" }],
  "ttkan.co": [{ url: "https://www.ttkan.co/" }],
  "novel543.com": [{ url: "https://www.novel543.com/" }],
  "uukanshu.com": [{ url: "https://www.uukanshu.com/" }],
};

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7,vi;q=0.6",
};

async function probe({ url, selector, encoding }: Probe) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { ...HEADERS, Referer: new URL(url).origin + "/" }, signal: AbortSignal.timeout(12_000) });
    const bytes = await res.arrayBuffer();
    const html = new TextDecoder(encoding ?? "utf-8").decode(bytes);
    const $ = cheerio.load(html);
    const matched = selector ? $(selector) : null;
    return {
      url,
      status: res.status,
      finalUrl: res.url,
      ms: Date.now() - started,
      bytes: bytes.byteLength,
      title: $("title").first().text().trim().slice(0, 80),
      justAMoment: html.includes("Just a moment"),
      challengePlatform: html.includes("challenge-platform"),
      cfMitigated: res.headers.get("cf-mitigated"),
      matches: matched ? matched.length : null,
      textChars: matched ? matched.text().replace(/\s/g, "").length : null,
      sample: matched ? matched.first().text().replace(/\s+/g, " ").trim().slice(0, 60) : null,
    };
  } catch (e) {
    return { url, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - started };
  }
}

// Pages behind Cloudflare's challenge for plain fetches: can a headless browser pass it?
const BROWSER_PROBES: Probe[] = [
  { url: "https://www.biquge7.xyz/52408/1", selector: "div.text" },
  { url: "https://www.xbanxia.cc/books/53578/25041601.html", selector: "#nr1" },
  { url: "https://www.piaotia.com/html/15/15678/13132376.html", selector: "#content, body" },
  { url: "https://www.69shuba.com/", selector: "body" },
  { url: "https://czbooks.net/", selector: "body" },
];

async function browserProbe({ url, selector }: Probe) {
  const started = Date.now();
  const puppeteer = await import("puppeteer-core");
  const chromium = await import("@sparticuz/chromium-min");
  const executablePath = await chromium.default.executablePath(
    "https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar"
  );
  const browser = await puppeteer.default.launch({ args: chromium.default.args, executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS["User-Agent"]);
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 }).catch(() => null);
    // Give a challenge time to solve itself
    for (let i = 0; i < 8; i++) {
      const title = await page.title().catch(() => "");
      if (!/Just a moment|Attention Required/i.test(title)) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    const html = await page.content();
    const $ = cheerio.load(html);
    const matched = selector ? $(selector) : null;
    return {
      url,
      firstStatus: res?.status() ?? null,
      finalUrl: page.url(),
      ms: Date.now() - started,
      title: $("title").first().text().trim().slice(0, 80),
      justAMoment: html.includes("Just a moment"),
      textChars: matched ? matched.text().replace(/\s/g, "").length : null,
      sample: matched ? matched.first().text().replace(/\s+/g, " ").trim().slice(0, 60) : null,
    };
  } catch (e) {
    return { url, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ms: Date.now() - started };
  } finally {
    await browser.close();
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("browser") === "1") {
    const results = [];
    for (const p of BROWSER_PROBES) results.push(await browserProbe(p).catch((e) => ({ url: p.url, launchError: e instanceof Error ? `${e.name}: ${e.message}` : String(e) })));
    return Response.json({ region: process.env.VERCEL_REGION ?? null, at: new Date().toISOString(), browser: results });
  }
  const results = await Promise.all(
    Object.entries(PROBES).map(async ([site, probes]) => {
      // One request at a time per site
      const checks = [];
      for (const p of probes) checks.push(await probe(p));
      return [site, checks] as const;
    })
  );
  return Response.json({ region: process.env.VERCEL_REGION ?? null, at: new Date().toISOString(), sites: Object.fromEntries(results) });
}
