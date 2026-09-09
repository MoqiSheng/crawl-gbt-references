#!/usr/bin/env node
/**
 * Google Scholar GB/T 7714 exporter for English references.
 *
 * Workflow:
 * 1. Open Google Scholar in a visible Chrome/Edge window.
 * 2. Search each English title.
 * 3. Click the Scholar "引用" button.
 * 4. Extract the GB/T 7714 row displayed by Scholar itself.
 *
 * This script does not bypass CAPTCHA, login, paywalls, or access controls.
 * If Google asks for verification, solve it manually in the opened browser.
 * The script polls the page and continues automatically after verification.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE || "playwright-core";
const { chromium } = loadPlaywright(playwrightPackage);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_USER_DATA_DIR = path.resolve(SCRIPT_DIR, "../.runtime/scholar-profile");

function loadPlaywright(packageName) {
  try {
    return require(packageName);
  } catch (firstError) {
    const candidates = [];
    const nodePathRoots = (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean);
    for (const root of nodePathRoots) {
      const pnpmRoot = path.join(root, ".pnpm");
      if (fs.existsSync(pnpmRoot)) {
        for (const name of fs.readdirSync(pnpmRoot)) {
          if (name.startsWith("playwright@")) {
            candidates.push(path.join(pnpmRoot, name, "node_modules", "playwright"));
          }
        }
      }
      candidates.push(path.join(root, "playwright"));
    }
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate)) return require(candidate);
      } catch {
        // Try the next candidate.
      }
    }
    throw firstError;
  }
}

function parseArgs(argv) {
  const args = {
    input: null,
    out: path.resolve("google_scholar_gbt_exporter/output"),
    limit: null,
    delay: 6000,
    stripDoiUrl: false,
    userDataDir: DEFAULT_USER_DATA_DIR,
    headless: false,
    keepOpen: false,
    cdp: "",
    executablePath: "",
    locale: "zh-CN",
    dryRun: false,
    manualTimeout: 600000,
    blockPoll: 5000,
    minTitleConfidence: 0.72,
    maxResults: 6,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--") && !args.input) {
      args.input = path.resolve(arg);
    } else if (arg === "--out") {
      args.out = path.resolve(argv[++i]);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++i]);
    } else if (arg === "--delay") {
      args.delay = Number(argv[++i]) * 1000;
    } else if (arg === "--strip-doi-url") {
      args.stripDoiUrl = true;
    } else if (arg === "--user-data-dir") {
      args.userDataDir = path.resolve(argv[++i]);
    } else if (arg === "--headless") {
      args.headless = true;
    } else if (arg === "--keep-open") {
      args.keepOpen = true;
    } else if (arg === "--cdp") {
      args.cdp = argv[++i];
    } else if (arg === "--executable-path") {
      args.executablePath = argv[++i];
    } else if (arg === "--locale") {
      args.locale = argv[++i];
    } else if (arg === "--manual-timeout") {
      args.manualTimeout = Number(argv[++i]) * 1000;
    } else if (arg === "--block-poll") {
      args.blockPoll = Number(argv[++i]) * 1000;
    } else if (arg === "--min-title-confidence") {
      args.minTitleConfidence = Number(argv[++i]);
    } else if (arg === "--max-results") {
      args.maxResults = Number(argv[++i]);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.input) throw new Error("Missing input file. Use --help for examples.");
  return args;
}

function printHelp() {
  console.log(`
Usage:
  node scholar_gbt_exporter.mjs <input> [options]

Input formats:
  .txt  one title per line, or key<TAB>title
  .csv  columns: key/title or id/title
  .md   simple reference list; English titles are extracted from APA-like lines

Options:
  --out DIR                  Output directory
  --limit N                  Process first N records
  --delay SECONDS            Delay between records, default 6
  --strip-doi-url            Remove DOI/URL from captured citation text
  --user-data-dir DIR        Persistent browser profile
  --cdp URL                  Connect to Chrome remote debugging, e.g. http://127.0.0.1:9222
  --executable-path EXE      Use local Chrome/Edge executable
  --manual-timeout SEC       Max time to wait for manual verification, default 600
  --block-poll SEC           Poll interval while waiting for manual verification, default 5
  --min-title-confidence N   Reject Scholar result below this score, default 0.72
  --max-results N            Search among first N Scholar results, default 6
  --keep-open                Leave browser open when finished
  --dry-run                  Only show parsed titles

Example:
  node scholar_gbt_exporter.mjs ./input/english_titles.txt --out ./output --strip-doi-url
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
    if (tab >= 0) {
      queries.push({ key: raw.slice(0, tab).trim(), title: raw.slice(tab + 1).trim(), raw });
    } else {
      queries.push({ key: String(idx + 1), title: raw, raw });
    }
  });
  return queries;
}

function readCsvQueries(text) {
  const rows = parseCsv(text);
  const [header, ...data] = rows;
  if (!header) return [];
  const lowerHeader = header.map((h) => h.trim().toLowerCase());
  const findCol = (...names) => lowerHeader.findIndex((h) => names.includes(h));
  const keyCol = findCol("key", "id");
  const titleCol = findCol("title");
  const queryCol = findCol("query", "search_query");
  if (titleCol < 0) return [];
  return data
    .map((row, idx) => ({
      key: (keyCol >= 0 ? row[keyCol] : String(idx + 2)) || String(idx + 2),
      title: row[titleCol] || "",
      query: queryCol >= 0 ? row[queryCol] || "" : "",
      raw: row.join(","),
    }))
    .filter((q) => q.title.trim())
    .map((q) => ({ ...q, key: q.key.trim(), title: q.title.trim(), query: q.query.trim() }));
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
      } else if (ch === '"') {
        quoted = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(value);
      value = "";
    } else if (ch === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += ch;
    }
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
    if (title && !/[\u3400-\u9fff]/.test(title)) {
      queries.push({ key: String(idx + 1), title, raw });
    }
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
    .replace(/&amp;/g, "&")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[：:;；,，.。!！?？"'“”‘’()\[\]{}<>《》【】\-–—_/\\|+*=~`^#@$%&\s]/g, "");
}

function titleTokens(value) {
  const cleaned = clean(value).toLowerCase();
  return cleaned
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !["the", "and", "for", "of", "in", "on", "a", "an"].includes(token));
}

function numericMarkers(value) {
  const text = clean(value).toLowerCase();
  const markers = new Set();
  for (const match of text.matchAll(/\d+(?:[.\-]\d+)?/g)) markers.add(match[0]);
  return markers;
}

function titleConfidence(queryTitle, matchedTitle) {
  const q = normalizeTitle(queryTitle);
  const m = normalizeTitle(matchedTitle);
  if (!q || !m) return 0;
  if (q === m) return 1;

  const qMarkers = numericMarkers(queryTitle);
  const mMarkers = numericMarkers(matchedTitle);
  for (const marker of qMarkers) {
    if (!mMarkers.has(marker)) return 0.05;
  }

  const lengthRatio = Math.min(q.length, m.length) / Math.max(q.length, m.length);
  if ((q.includes(m) || m.includes(q)) && lengthRatio >= 0.78) return 0.92 * lengthRatio + 0.08;

  const qt = new Set(titleTokens(queryTitle));
  const mt = new Set(titleTokens(matchedTitle));
  if (qt.size === 0 || mt.size === 0) return 0;
  let overlap = 0;
  for (const token of qt) if (mt.has(token)) overlap += 1;
  const dice = (2 * overlap) / (qt.size + mt.size);
  return Math.max(dice * lengthRatio, dice * 0.8);
}

async function createBrowser(args) {
  if (args.cdp) {
    const browser = await chromium.connectOverCDP(args.cdp);
    const context = browser.contexts()[0] || (await browser.newContext({ locale: args.locale }));
    return { context, close: async () => browser.close() };
  }

  const context = await chromium.launchPersistentContext(args.userDataDir, {
    headless: args.headless,
    locale: args.locale,
    viewport: { width: 1365, height: 900 },
    executablePath: args.executablePath || undefined,
    args: ["--lang=zh-CN"],
  });
  return { context, close: async () => context.close() };
}

async function detectBlock(page) {
  const url = page.url();
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  const lowered = `${url}\n${text}`.toLowerCase();
  if (lowered.includes("/sorry/") || lowered.includes("captcha") || lowered.includes("unusual traffic") || text.includes("请进行人机身份验证") || text.includes("人机身份验证")) {
    return "CAPTCHA / unusual traffic";
  }
  if (text.includes("系统目前无法执行此操作") || text.includes("请稍后再试")) {
    return "系统目前无法执行此操作，请稍后再试";
  }
  return "";
}

async function waitForManualIfBlocked(page, label, args) {
  let blocked = await detectBlock(page);
  const started = Date.now();
  let announced = false;
  while (blocked) {
    if (!announced) {
      console.log(`  Scholar blocked/interrupted (${label}): ${blocked}`);
      console.log("  Please solve/confirm in the opened browser. The script will continue automatically.");
      announced = true;
    }
    if (Date.now() - started > args.manualTimeout) throw new Error(`manual verification timed out: ${blocked}`);
    await page.waitForTimeout(args.blockPoll);
    blocked = await detectBlock(page);
  }
}

async function crawlOne(page, query, args) {
  const searchTerms = query.query || query.title;
  const searchUrl = `https://scholar.google.com/scholar?hl=${encodeURIComponent(args.locale)}&q=${encodeURIComponent(searchTerms)}`;
  const result = {
    key: query.key,
    title: query.title,
    status: "unknown",
    citation: "",
    matchedTitle: "",
    titleConfidence: "",
    notes: "",
    url: searchUrl,
  };

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((error) => {
    result.status = "navigation_error";
    result.notes = error.message;
  });
  if (result.status === "navigation_error") return result;

  await waitForManualIfBlocked(page, query.title, args);

  const resultCards = page.locator(".gs_r.gs_or");
  const resultCount = await resultCards.count();
  if (resultCount === 0) {
    result.status = "no_result";
    result.notes = "No Scholar result found";
    return result;
  }

  const candidates = [];
  const inspectCount = Math.min(resultCount, args.maxResults);
  for (let i = 0; i < inspectCount; i += 1) {
    const card = resultCards.nth(i);
    const title = clean(await card.locator(".gs_rt").innerText({ timeout: 5000 }).catch(() => ""));
    candidates.push({ card, title, confidence: titleConfidence(query.title, title) });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const chosen = candidates[0];
  result.matchedTitle = chosen?.title || "";
  result.titleConfidence = chosen?.confidence?.toFixed(3) || "0";
  if (!chosen || chosen.confidence < args.minTitleConfidence) {
    result.status = "title_mismatch";
    result.notes = `Best Scholar title confidence ${result.titleConfidence}; best="${result.matchedTitle}"`;
    return result;
  }

  const cite = chosen.card.locator(".gs_or_cit, a:has-text('引用'), button:has-text('引用')").first();
  if ((await cite.count()) === 0) {
    result.status = "no_cite_button";
    result.notes = "No citation button found";
    return result;
  }

  await cite.click({ timeout: 15000 });
  await page.locator("#gs_cit").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await page.locator("#gs_citt, #gs_cit-bdy").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await waitForManualIfBlocked(page, `cite popup: ${query.title}`, args);

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("#gs_citt tr").forEach((row) => {
      const label = row.querySelector("th")?.textContent?.trim() || "";
      const citation = row.querySelector("td")?.textContent?.replace(/\s+/g, " ").trim() || "";
      if (label || citation) out.push({ label, citation });
    });
    if (out.length === 0) {
      document.querySelectorAll("#gs_cit-bdy .gs_citr").forEach((node, idx) => {
        out.push({ label: `citation_${idx + 1}`, citation: node.textContent?.replace(/\s+/g, " ").trim() || "" });
      });
    }
    return out;
  });

  const gbt = rows.find((row) => /GB\s*\/?\s*T|7714/i.test(row.label));
  if (!gbt || !gbt.citation) {
    result.status = "no_gbt";
    result.notes = `Citation labels: ${rows.map((row) => row.label).join(", ") || "none"}`;
    await closeCitationPopup(page);
    return result;
  }

  result.status = "ok";
  result.citation = args.stripDoiUrl ? stripDoiUrl(gbt.citation) : clean(gbt.citation);
  await closeCitationPopup(page);
  return result;
}

async function closeCitationPopup(page) {
  await page.keyboard.press("Escape").catch(() => {});
  const close = page.locator("#gs_cit-x").first();
  if ((await close.count()) > 0) await close.click({ timeout: 3000 }).catch(() => {});
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function writeOutputs(results, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const okLines = results.filter((r) => r.status === "ok" && r.citation).map((r) => r.citation);
  fs.writeFileSync(path.join(outDir, "scholar_gbt.txt"), okLines.join("\n") + (okLines.length ? "\n" : ""), "utf8");

  const header = ["key", "title", "status", "citation", "matchedTitle", "titleConfidence", "notes", "url"];
  const rows = [header.join(",")].concat(results.map((r) => header.map((key) => csvEscape(r[key])).join(",")));
  fs.writeFileSync(path.join(outDir, "scholar_results.csv"), rows.join("\n") + "\n", "utf8");

  const review = [header.join(",")].concat(
    results.filter((r) => r.status !== "ok").map((r) => header.map((key) => csvEscape(r[key])).join(",")),
  );
  fs.writeFileSync(path.join(outDir, "scholar_needs_review.csv"), review.join("\n") + "\n", "utf8");
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
        results.push({
          key: query.key,
          title: query.title,
          status: "error",
          citation: "",
          matchedTitle: "",
          titleConfidence: "",
          notes: error.message,
          url: page.url(),
        });
      }
      writeOutputs(results, args.out);
      if (i < queries.length - 1 && args.delay > 0) await page.waitForTimeout(args.delay);
    }
  } finally {
    writeOutputs(results, args.out);
    if (!args.keepOpen) await close();
  }

  console.log(`Done. OK=${results.filter((r) => r.status === "ok").length}, total=${results.length}`);
  console.log(`Wrote: ${path.join(args.out, "scholar_gbt.txt")}`);
  console.log(`Wrote: ${path.join(args.out, "scholar_results.csv")}`);
  console.log(`Wrote: ${path.join(args.out, "scholar_needs_review.csv")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
