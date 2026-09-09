#!/usr/bin/env node
/**
 * CNKI GB/T citation exporter for Chinese references.
 *
 * Workflow:
 * 1. Open CNKI in a visible Chrome/Edge window.
 * 2. Search each Chinese title.
 * 3. Locate the best matching result.
 * 4. Click CNKI's "引用" action.
 * 5. Extract the GB/T 7714 row from CNKI's citation dialog.
 *
 * This script does not bypass login, institutional access, CAPTCHA, or paywalls.
 * If CNKI asks for login/verification, handle it manually in the opened browser.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE || "playwright-core";
const { chromium } = loadPlaywright(playwrightPackage);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_USER_DATA_DIR = path.resolve(SCRIPT_DIR, "../.runtime/cnki-profile");

function loadPlaywright(packageName) {
  try {
    return require(packageName);
  } catch (firstError) {
    const candidates = [];
    const roots = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
    for (const root of roots) {
      const pnpmRoot = path.join(root, ".pnpm");
      if (fs.existsSync(pnpmRoot)) {
        for (const name of fs.readdirSync(pnpmRoot)) {
          if (name.startsWith("playwright@")) candidates.push(path.join(pnpmRoot, name, "node_modules", "playwright"));
        }
      }
      candidates.push(path.join(root, "playwright"));
    }
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return require(candidate);
      } catch {
        // Continue.
      }
    }
    throw firstError;
  }
}

function parseArgs(argv) {
  const args = {
    input: null,
    out: path.resolve("cnki_gbt_exporter/output"),
    limit: null,
    delay: 5000,
    stripDoiUrl: false,
    userDataDir: DEFAULT_USER_DATA_DIR,
    keepOpen: false,
    headless: false,
    cdp: "",
    executablePath: "",
    manualTimeout: 600000,
    blockPoll: 5000,
    minTitleConfidence: 0.72,
    maxResults: 10,
    dryRun: false,
    searchMode: "ui",
    startUrl: "https://kns.cnki.net/kns8s/defaultresult/index",
    homeUrl: "https://www.cnki.net/",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--") && !args.input) args.input = path.resolve(arg);
    else if (arg === "--out") args.out = path.resolve(argv[++i]);
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--delay") args.delay = Number(argv[++i]) * 1000;
    else if (arg === "--strip-doi-url") args.stripDoiUrl = true;
    else if (arg === "--user-data-dir") args.userDataDir = path.resolve(argv[++i]);
    else if (arg === "--keep-open") args.keepOpen = true;
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--cdp") args.cdp = argv[++i];
    else if (arg === "--executable-path") args.executablePath = argv[++i];
    else if (arg === "--manual-timeout") args.manualTimeout = Number(argv[++i]) * 1000;
    else if (arg === "--block-poll") args.blockPoll = Number(argv[++i]) * 1000;
    else if (arg === "--min-title-confidence") args.minTitleConfidence = Number(argv[++i]);
    else if (arg === "--max-results") args.maxResults = Number(argv[++i]);
    else if (arg === "--search-mode") args.searchMode = argv[++i];
    else if (arg === "--start-url") args.startUrl = argv[++i];
    else if (arg === "--home-url") args.homeUrl = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) throw new Error("Missing input file. Use --help.");
  if (!["ui", "direct"].includes(args.searchMode)) throw new Error("--search-mode must be ui or direct.");
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node cnki_gbt_exporter.mjs <input> [options]

Input formats:
  .txt  one title per line, or key<TAB>title
  .csv  columns: key/title or id/title/题名/篇名
  .md   simple reference list; Chinese titles are extracted

Options:
  --out DIR                 Output directory
  --limit N                 Process first N records
  --delay SECONDS           Delay between records, default 5
  --strip-doi-url           Remove DOI/URL from captured citation text
  --user-data-dir DIR       Persistent browser profile
  --cdp URL                 Connect to Chrome remote debugging
  --executable-path EXE     Use local Chrome/Edge executable
  --manual-timeout SEC      Max wait for manual login/verification, default 600
  --min-title-confidence N  Reject result below this score, default 0.72
  --search-mode ui|direct   Search from CNKI home UI first, or direct kw URL
  --keep-open               Leave browser open when finished
  --dry-run                 Only show parsed titles

Example:
  node cnki_gbt_exporter.mjs ./input/chinese_titles.txt --out ./output --strip-doi-url
`);
}

function readQueries(file) {
  const ext = path.extname(file).toLowerCase();
  const text = fs.readFileSync(file, "utf8");
  if (ext === ".csv") return readCsvQueries(text);
  if (ext === ".md" || ext === ".markdown") return readMarkdownQueries(text);
  return readTextQueries(text);
}

function readTextQueries(text) {
  const queries = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) return;
    const tab = raw.indexOf("\t");
    if (tab >= 0) queries.push({ key: raw.slice(0, tab).trim(), title: raw.slice(tab + 1).trim(), raw });
    else queries.push({ key: String(idx + 1), title: raw, raw });
  });
  return queries.filter((q) => q.title);
}

function readCsvQueries(text) {
  const rows = parseCsv(text);
  const [header, ...data] = rows;
  if (!header) return [];
  const lower = header.map((h) => h.trim().toLowerCase());
  const findCol = (...names) => lower.findIndex((h) => names.includes(h));
  const keyCol = findCol("key", "id");
  const titleCol = findCol("title", "题名", "篇名");
  if (titleCol < 0) return [];
  return data
    .map((row, idx) => ({
      key: (keyCol >= 0 ? row[keyCol] : String(idx + 2)) || String(idx + 2),
      title: row[titleCol] || "",
      raw: row.join(","),
    }))
    .filter((q) => q.title.trim())
    .map((q) => ({ ...q, key: q.key.trim(), title: q.title.trim() }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else value += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(value);
      value = "";
    } else if (ch === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else value += ch;
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function readMarkdownQueries(text) {
  const queries = [];
  text.split(/\r?\n/).forEach((line, idx) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || raw.endsWith("：")) return;
    const title = extractTitle(raw);
    if (title && /[\u3400-\u9fff]/.test(title)) queries.push({ key: String(idx + 1), title, raw });
  });
  return queries;
}

function extractTitle(line) {
  const apa = line.match(/^.+?\.\s*\((?:19|20)\d{2}\)\.\s*(.+?)(?:\.\s+|$)/);
  if (apa) return clean(apa[1]);
  const gbt = line.match(/^.+?\.\s*(.+?)\[[A-Z/]+\]/);
  if (gbt) return clean(gbt[1]);
  return "";
}

function clean(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function stripDoiUrl(value) {
  return clean(
    value
      .replace(/\s*(https?:\/\/doi\.org\/\S+|doi:\s*10\.\S+|DOI:\s*10\.\S+)\s*\.?/gi, "")
      .replace(/\s*https?:\/\/\S+\s*\.?/gi, ""),
  );
}

function normalizeTitle(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[：:;；,，.。!！?？"'“”‘’()\[\]{}<>《》【】\-–—_/\\|+*=~`^#@$%&\s]/g, "");
}

function numericMarkers(value) {
  const text = clean(value).toLowerCase();
  const markers = new Set();
  for (const match of text.matchAll(/\d+(?:[.\-]\d+)?/g)) markers.add(match[0]);
  for (const match of text.matchAll(/第[一二三四五六七八九十百千万两〇零]+[个届次章节期版]?/g)) markers.add(match[0]);
  return markers;
}

function titleConfidence(queryTitle, matchedTitle) {
  const q = normalizeTitle(queryTitle);
  const m = normalizeTitle(matchedTitle);
  if (!q || !m) return 0;
  if (q === m) return 1;
  const qMarkers = numericMarkers(queryTitle);
  const mMarkers = numericMarkers(matchedTitle);
  for (const marker of qMarkers) if (!mMarkers.has(marker)) return 0.05;
  const lengthRatio = Math.min(q.length, m.length) / Math.max(q.length, m.length);
  if ((q.includes(m) || m.includes(q)) && lengthRatio >= 0.78) return 0.92 * lengthRatio + 0.08;

  const qChars = new Set(Array.from(q));
  const mChars = new Set(Array.from(m));
  let overlap = 0;
  for (const ch of qChars) if (mChars.has(ch)) overlap += 1;
  const dice = (2 * overlap) / (qChars.size + mChars.size);
  return Math.max(dice * lengthRatio, dice * 0.82);
}

async function createBrowser(args) {
  if (args.cdp) {
    const browser = await chromium.connectOverCDP(args.cdp);
    const context = browser.contexts()[0] || (await browser.newContext({ locale: "zh-CN" }));
    return { context, close: async () => browser.close() };
  }
  const context = await chromium.launchPersistentContext(args.userDataDir, {
    headless: args.headless,
    locale: "zh-CN",
    viewport: { width: 1365, height: 900 },
    executablePath: args.executablePath || undefined,
    args: ["--lang=zh-CN"],
  });
  return { context, close: async () => context.close() };
}

async function detectBlock(page) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const url = page.url();
  const hasResultsOrCitation = /引用|GB\/T 7714|下载|被引|篇名|题名|检索结果|找到\s*\d+\s*条|结果/.test(text);
  if (/captchaId=/.test(url)) {
    return "CNKI verification prompt";
  }
  if (!hasResultsOrCitation && /验证码|安全验证|拖动滑块|滑块验证|人机验证/.test(text)) {
    return "CNKI verification prompt";
  }
  if (!hasResultsOrCitation && /机构登录|个人登录|统一身份认证|账号登录|用户名|密码|请先登录|请登录/.test(text)) {
    return "CNKI login/verification/access prompt";
  }
  return "";
}

async function waitForManualIfBlocked(page, label, args) {
  let blocked = await detectBlock(page);
  const started = Date.now();
  let announced = false;
  while (blocked) {
    if (!announced) {
      console.log(`  CNKI needs manual action (${label}): ${blocked}`);
      console.log("  Please handle it in the opened browser. The script will continue automatically.");
      announced = true;
    }
    if (Date.now() - started > args.manualTimeout) throw new Error(`manual action timed out: ${blocked}`);
    await page.waitForTimeout(args.blockPoll);
    blocked = await detectBlock(page);
  }
}

async function searchCnki(page, title, args) {
  if (args.searchMode === "ui") {
    const searched = await searchCnkiViaHome(page, title, args);
    if (searched) return;
  }

  await searchCnkiDirect(page, title, args);
}

async function searchCnkiDirect(page, title, args) {
  const directUrl = `${args.startUrl}?kw=${encodeURIComponent(title)}`;
  await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await waitForManualIfBlocked(page, title, args);

  const hasResults = await page.locator("body").innerText({ timeout: 5000 }).then((t) => /引用|下载|被引|篇名|题名|检索结果|结果/.test(t)).catch(() => false);
  if (hasResults) return;

  await searchCnkiViaHome(page, title, args);
}

async function searchCnkiViaHome(page, title, args) {
  await page.goto(args.homeUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await waitForManualIfBlocked(page, "CNKI home", args);
  const filled = await page.evaluate((query) => {
    const inputs = Array.from(document.querySelectorAll("input"));
    const input = inputs.find((el) => {
      const attrs = `${el.id} ${el.name} ${el.className} ${el.placeholder}`.toLowerCase();
      return /search|keyword|kw|txt|检索|搜索|请输入/.test(attrs) && el.offsetParent !== null;
    });
    if (!input) return false;
    input.focus();
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, title);
  if (!filled) return false;

  const clicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button,input[type='button'],input[type='submit'],a"));
    const button = buttons.find((el) => {
      const text = `${el.textContent || ""} ${el.value || ""} ${el.id || ""} ${el.className || ""} ${el.title || ""}`;
      return /检索|搜索|search|btnSearch/i.test(text) && el.offsetParent !== null;
    });
    if (!button) return false;
    button.click();
    return true;
  });
  if (!clicked) await page.keyboard.press("Enter").catch(() => {});
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await waitForManualIfBlocked(page, title, args);
  return page.locator("body").innerText({ timeout: 5000 }).then((t) => /引用|下载|被引|篇名|题名|检索结果|找到\s*\d+\s*条|结果/.test(t)).catch(() => false);
}

async function findAndClickCitation(page, query, args) {
  return page.evaluate(
    ({ title, minTitleConfidence, maxResults }) => {
      function clean(value) {
        return String(value || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      }
      function normalizeTitle(value) {
        return clean(value)
          .toLowerCase()
          .replace(/[：:;；,，.。!！?？"'“”‘’()\[\]{}<>《》【】\-–—_/\\|+*=~`^#@$%&\s]/g, "");
      }
      function numericMarkers(value) {
        const text = clean(value).toLowerCase();
        const markers = new Set();
        for (const match of text.matchAll(/\d+(?:[.\-]\d+)?/g)) markers.add(match[0]);
        for (const match of text.matchAll(/第[一二三四五六七八九十百千万两〇零]+[个届次章节期版]?/g)) markers.add(match[0]);
        return markers;
      }
      function titleConfidence(queryTitle, matchedTitle) {
        const q = normalizeTitle(queryTitle);
        const m = normalizeTitle(matchedTitle);
        if (!q || !m) return 0;
        if (q === m) return 1;
        const qMarkers = numericMarkers(queryTitle);
        const mMarkers = numericMarkers(matchedTitle);
        for (const marker of qMarkers) if (!mMarkers.has(marker)) return 0.05;
        const lengthRatio = Math.min(q.length, m.length) / Math.max(q.length, m.length);
        if ((q.includes(m) || m.includes(q)) && lengthRatio >= 0.78) return 0.92 * lengthRatio + 0.08;
        const qChars = new Set(Array.from(q));
        const mChars = new Set(Array.from(m));
        let overlap = 0;
        for (const ch of qChars) if (mChars.has(ch)) overlap += 1;
        const dice = (2 * overlap) / (qChars.size + mChars.size);
        return Math.max(dice * lengthRatio, dice * 0.82);
      }
      function visible(el) {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      function closestContainer(el) {
        return el.closest("tr") || el.closest(".result-table-list") || el.closest(".list-item") || el.closest(".item") || el.closest("li") || el.parentElement;
      }
      function findCitationControl(container) {
        if (!container) return null;
        const selectors = [
          '[title*="引用"]',
          '[aria-label*="引用"]',
          'a[href*="quote"]',
          'a[onclick*="quote"]',
          'a[onclick*="Quote"]',
          'i[title*="引用"]',
          'span[title*="引用"]',
          ".quote",
          ".icon-quote",
          ".icon-yinyong",
          ".quote-icon",
        ];
        for (const selector of selectors) {
          const node = container.querySelector(selector);
          if (node) return node.closest("a,button") || node;
        }
        const links = Array.from(container.querySelectorAll("a,button,span,i"));
        return links.find((node) => /引用/.test(`${node.textContent || ""} ${node.title || ""} ${node.getAttribute("aria-label") || ""}`));
      }

      const anchors = Array.from(document.querySelectorAll("a")).filter((a) => visible(a) && clean(a.textContent).length >= 4);
      const candidates = anchors
        .map((a) => ({ node: a, text: clean(a.textContent), confidence: titleConfidence(title, clean(a.textContent)) }))
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, maxResults);
      const best = candidates[0];
      if (!best || best.confidence < minTitleConfidence) {
        return { status: "title_mismatch", matchedTitle: best?.text || "", titleConfidence: best?.confidence?.toFixed(3) || "0", notes: "No sufficiently similar CNKI result title" };
      }
      let container = closestContainer(best.node);
      let control = findCitationControl(container);
      if (!control && container?.parentElement) control = findCitationControl(container.parentElement);
      if (!control) {
        const globalQuoteControls = Array.from(document.querySelectorAll("a.icon-quote, .icon-quote"))
          .map((node) => node.closest("a,button") || node)
          .filter((node) => visible(node));
        if (globalQuoteControls.length === 1) control = globalQuoteControls[0];
      }
      if (!control) {
        return { status: "no_cite_button", matchedTitle: best.text, titleConfidence: best.confidence.toFixed(3), notes: "No citation action found near matched title" };
      }
      control.click();
      return { status: "clicked", matchedTitle: best.text, titleConfidence: best.confidence.toFixed(3), notes: "" };
    },
    { title: query.title, minTitleConfidence: args.minTitleConfidence, maxResults: args.maxResults },
  );
}

async function extractGbtCitation(page) {
  await page.waitForTimeout(1500);
  await page.locator("text=/GB\\/T\\s*7714/").first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  return page.evaluate(() => {
    function clean(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }
    const bodyText = document.body.innerText || "";
    const lines = bodyText.split(/\n/).map((line) => clean(line)).filter(Boolean);
    for (let i = 0; i < lines.length; i += 1) {
      if (/GB\/T\s*7714/.test(lines[i])) {
        let citation = lines[i].replace(/^.*?GB\/T\s*7714(?:-\d{4})?\s*格式?引文\s*/i, "").trim();
        if (!citation && lines[i + 1]) citation = lines[i + 1].trim();
        if (citation && !/^MLA|^APA|^EndNote|^NoteExpress|^Refworks/i.test(citation)) return citation;
      }
    }
    const nodes = Array.from(document.querySelectorAll("*")).filter((node) => /GB\/T\s*7714/.test(node.textContent || ""));
    for (const node of nodes) {
      const row = node.closest("tr") || node.parentElement;
      const text = clean(row?.innerText || node.textContent || "");
      const citation = text.replace(/^.*?GB\/T\s*7714(?:-\d{4})?\s*格式?引文\s*/i, "").trim();
      if (citation && !/^MLA|^APA/i.test(citation)) return citation;
    }
    return "";
  });
}

async function closeCitationPopup(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    const close = Array.from(document.querySelectorAll("a,button,span,i")).find((el) => /×|关闭|取消/.test(el.textContent || el.title || el.getAttribute("aria-label") || ""));
    if (close) close.click();
  }).catch(() => {});
}

async function crawlOne(page, query, args) {
  const result = {
    key: query.key,
    title: query.title,
    status: "unknown",
    citation: "",
    matchedTitle: "",
    titleConfidence: "",
    notes: "",
    url: "",
  };

  await searchCnki(page, query.title, args);
  result.url = page.url();
  await waitForManualIfBlocked(page, query.title, args);

  const clicked = await findAndClickCitation(page, query, args);
  result.status = clicked.status;
  result.matchedTitle = clicked.matchedTitle || "";
  result.titleConfidence = clicked.titleConfidence || "";
  result.notes = clicked.notes || "";
  if (clicked.status !== "clicked") return result;

  const citation = await extractGbtCitation(page);
  if (!citation) {
    result.status = "no_gbt";
    result.notes = "Citation dialog opened, but GB/T 7714 row was not extracted";
    return result;
  }

  result.status = "ok";
  result.citation = args.stripDoiUrl ? stripDoiUrl(citation) : clean(citation);
  await closeCitationPopup(page);
  return result;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeOutputs(results, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const okLines = results.filter((r) => r.status === "ok" && r.citation).map((r) => r.citation);
  fs.writeFileSync(path.join(outDir, "cnki_gbt.txt"), okLines.join("\n") + (okLines.length ? "\n" : ""), "utf8");

  const header = ["key", "title", "status", "citation", "matchedTitle", "titleConfidence", "notes", "url"];
  const rows = [header.join(",")].concat(results.map((r) => header.map((key) => csvEscape(r[key])).join(",")));
  fs.writeFileSync(path.join(outDir, "cnki_results.csv"), rows.join("\n") + "\n", "utf8");
  const review = [header.join(",")].concat(results.filter((r) => r.status !== "ok").map((r) => header.map((key) => csvEscape(r[key])).join(",")));
  fs.writeFileSync(path.join(outDir, "cnki_needs_review.csv"), review.join("\n") + "\n", "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let queries = readQueries(args.input);
  if (args.limit !== null && Number.isFinite(args.limit)) queries = queries.slice(0, args.limit);
  if (args.dryRun) {
    queries.forEach((q) => console.log(`${q.key}\t${q.title}`));
    return;
  }

  const { context, close } = await createBrowser(args);
  const page = context.pages()[0] || (await context.newPage());
  const results = [];
  try {
    for (let i = 0; i < queries.length; i += 1) {
      const query = queries[i];
      console.log(`[${i + 1}/${queries.length}] ${query.title}`);
      try {
        const result = await crawlOne(page, query, args);
        console.log(`  -> ${result.status}${result.citation ? `: ${result.citation.slice(0, 120)}` : ""}`);
        results.push(result);
      } catch (error) {
        console.log(`  -> error: ${error.message}`);
        results.push({ key: query.key, title: query.title, status: "error", citation: "", matchedTitle: "", titleConfidence: "", notes: error.message, url: page.url() });
      }
      writeOutputs(results, args.out);
      if (i < queries.length - 1 && args.delay > 0) await page.waitForTimeout(args.delay);
    }
  } finally {
    writeOutputs(results, args.out);
    if (!args.keepOpen) await close();
  }
  console.log(`Done. OK=${results.filter((r) => r.status === "ok").length}, total=${results.length}`);
  console.log(`Wrote: ${path.join(args.out, "cnki_gbt.txt")}`);
  console.log(`Wrote: ${path.join(args.out, "cnki_results.csv")}`);
  console.log(`Wrote: ${path.join(args.out, "cnki_needs_review.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
