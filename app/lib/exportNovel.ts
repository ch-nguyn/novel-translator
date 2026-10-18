import { SavedChapter } from "./types";
import { extractChapterNumber } from "./storage";
import { zipFiles } from "./zip";

export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "novel";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export function orderNovelChapters(chapters: SavedChapter[], order?: string[]): SavedChapter[] {
  const compare = (a: number, b: number) => {
    const aNumber = extractChapterNumber(chapters[a].title) ?? Infinity;
    const bNumber = extractChapterNumber(chapters[b].title) ?? Infinity;
    return (aNumber === bNumber ? 0 : aNumber - bNumber) || chapters[a].savedAt - chapters[b].savedAt || a - b;
  };
  const indices = chapters.map((_, index) => index).sort(compare);
  const byUrl = new Map<string, number>();
  const following = new Map<string, number[]>();
  for (const index of indices) {
    const chapter = chapters[index];
    if (!byUrl.has(chapter.url)) byUrl.set(chapter.url, index);
    if (chapter.prevUrl !== null) {
      const next = following.get(chapter.prevUrl) ?? [];
      next.push(index);
      following.set(chapter.prevUrl, next);
    }
  }
  const visited = new Set<number>();
  const chains: number[][] = [];
  const follow = (start: number) => {
    const chain: number[] = [];
    let index: number | undefined = start;
    while (index !== undefined && !visited.has(index)) {
      visited.add(index);
      chain.push(index);
      const chapter: SavedChapter = chapters[index];
      const next: number | undefined = chapter.nextUrl === null ? undefined : byUrl.get(chapter.nextUrl);
      index = next !== undefined && !visited.has(next)
        ? next
        : following.get(chapter.url)?.find((candidate) => !visited.has(candidate));
    }
    if (chain.length) chains.push(chain);
  };
  for (const index of indices) {
    const prev = chapters[index].prevUrl;
    if (prev === null || !byUrl.has(prev)) follow(index);
  }
  // A cycle has no starting chapter; visit any leftovers once, including duplicate URLs.
  for (const index of indices) follow(index);
  const fallback = chains.sort((a, b) => compare(a[0], b[0])).flat();
  if (!order) return fallback.map((index) => chapters[index]);
  // By path: a novel's chapters are on one site, saved under www. or not
  const key = (url: string) => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  };
  const positions = new Map<string, number>();
  order.forEach((url, index) => {
    if (!positions.has(key(url))) positions.set(key(url), index);
  });
  return fallback
    .map((index) => chapters[index])
    .sort((a, b) => (positions.get(key(a.url)) ?? Infinity) - (positions.get(key(b.url)) ?? Infinity) || 0);
}

// Exports keep the supplied order, including an order resolved from the source TOC.
export function exportNovelTxt(novelName: string, chapters: SavedChapter[]): void {
  const text = `${novelName}\n\n${chapters.map((chapter) => `${chapter.title}\n\n${chapter.simplifiedText}\n\n\n`).join("")}`;
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `${safeFilename(novelName)}.txt`);
}

function xml(text: string): string {
  return text
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exportNovelEpub(novelName: string, chapters: SavedChapter[], lang = "vi"): void {
  const title = xml(novelName || "Untitled");
  const language = xml(lang);
  const identifier = `urn:uuid:${crypto.randomUUID()}`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  // An EPUB needs a content document even when no chapters were saved.
  const content = chapters.length ? chapters : [{ title: novelName, simplifiedText: "" }];
  const pages = content.map((chapter, index) => ({
    id: `chapter-${index + 1}`,
    href: `chapter-${index + 1}.xhtml`,
    title: xml(chapter.title || `Chapter ${index + 1}`),
    paragraphs: chapter.simplifiedText.split("\n").filter((line) => line.trim()).map((line) => `<p>${xml(line)}</p>`).join("\n"),
  }));
  const xhtml = (pageTitle: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}">
<head><title>${pageTitle}</title><link rel="stylesheet" type="text/css" href="style.css" /></head>
<body>${body}</body></html>`;
  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>` },
    { name: "OEBPS/content.opf", data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:language>${language}</dc:language>
<meta property="dcterms:modified">${modified}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" /><item id="css" href="style.css" media-type="text/css" />
${pages.map((page) => `<item id="${page.id}" href="${page.href}" media-type="application/xhtml+xml" />`).join("\n")}</manifest>
<spine toc="ncx">${pages.map((page) => `<itemref idref="${page.id}" />`).join("")}</spine></package>` },
    { name: "OEBPS/nav.xhtml", data: xhtml(title, `<nav epub:type="toc" id="toc"><h1>${title}</h1><ol>${pages.map((page) => `<li><a href="${page.href}">${page.title}</a></li>`).join("")}</ol></nav>`) },
    { name: "OEBPS/toc.ncx", data: `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${language}">
<head><meta name="dtb:uid" content="${identifier}" /><meta name="dtb:depth" content="1" /><meta name="dtb:totalPageCount" content="0" /><meta name="dtb:maxPageNumber" content="0" /></head>
<docTitle><text>${title}</text></docTitle><navMap>${pages.map((page, index) => `<navPoint id="${page.id}" playOrder="${index + 1}"><navLabel><text>${page.title}</text></navLabel><content src="${page.href}" /></navPoint>`).join("")}</navMap></ncx>` },
    { name: "OEBPS/style.css", data: "body { line-height: 1.6; margin: 5%; } h2 { text-align: center; } p { text-indent: 1.5em; margin: 0.5em 0; }" },
    ...pages.map((page) => ({ name: `OEBPS/${page.href}`, data: xhtml(page.title, `<h2>${page.title}</h2>\n${page.paragraphs}`) })),
  ];
  downloadBlob(new Blob([zipFiles(files)], { type: "application/epub+zip" }), `${safeFilename(novelName)}.epub`);
}
