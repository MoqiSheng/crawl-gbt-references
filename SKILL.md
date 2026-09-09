---
name: crawl-gbt-references
description: Crawl verified GB/T 7714 citations from Google Scholar for English academic literature and CNKI for Chinese academic literature, separate policy documents for official-source verification, deduplicate and sort bibliography entries, and append them to Markdown, text, or DOCX manuscripts. Use when Codex needs to collect Chinese/English references, export platform-provided GB/T citations, audit title matches, remove DOI/URLs, prepare a final bibliography, or insert references into an article or thesis.
---

# Crawl GB/T References

Use the bundled scripts to obtain platform-exported citations, audit them, prepare one bibliography, and append it to a manuscript.

## Core Rules

1. Send English academic titles to Google Scholar and Chinese academic titles to CNKI.
2. Do not send policy files, course standards, government notices, or speeches to Scholar/CNKI. Verify them against official sources and format them separately.
3. Treat a citation as directly crawled only when it came from the platform's visible `GB/T 7714` row.
4. Never bypass CAPTCHA, login, institutional access, or rate limits. Ask the user to complete a visible verification and continue afterward.
5. Check matched title, authors, year, source, volume/issue, and pages. Put mismatches and incomplete metadata into the review queue.
6. Keep platform exports unchanged except for an explicitly requested DOI/URL removal. Record any manual correction separately.
7. Never overwrite a manuscript by default. Create a new output file.

## First-Time Setup

Clone the repository directly into the Codex skills directory on Windows:

```powershell
git clone <repository-url> "$env:USERPROFILE\.codex\skills\crawl-gbt-references"
```

Restart Codex after cloning so the skill is discovered. Then run:

```powershell
& "<skill-dir>/scripts/setup.ps1"
```

This installs local runtime dependencies only. Browser profiles are written to `.runtime/`, which is excluded from Git.

## Workflow

### 1. Split a Mixed Reference List

For a Markdown list containing Chinese, English, and policy references:

```powershell
python "<skill-dir>/scripts/split_references.py" references.md --out work/queues
```

Review `split_manifest.csv` before crawling. Correct any misclassified policy item.

### 2. Crawl English References

```powershell
& "<skill-dir>/scripts/run-scholar.ps1" -InputPath work/queues/scholar_en_queries.txt -OutDir work/scholar -StripDoiUrl
```

Use a CSV with `key,title,query` when a book, chapter, or common title needs author/year/publisher terms to narrow Scholar search. Title matching still uses `title`.

### 3. Crawl Chinese References

```powershell
& "<skill-dir>/scripts/run-cnki.ps1" -InputPath work/queues/cnki_zh_queries.txt -OutDir work/cnki -StripDoiUrl
```

Start with UI search mode. Use `-SearchMode direct` only if the normal CNKI page cannot reach results.

### 4. Resolve Review Queues

Read `scholar_needs_review.csv` and `cnki_needs_review.csv`. Do not silently accept `title_mismatch`, `no_gbt`, missing pages, wrong editions, or same-title records with different years.

For detailed checks and known platform limitations, read [references/quality-control.md](references/quality-control.md).

### 5. Prepare the Final Bibliography

Combine platform outputs and manually verified policy entries:

```powershell
python "<skill-dir>/scripts/prepare_bibliography.py" work/cnki/cnki_gbt.txt work/scholar/scholar_gbt.txt work/policy_gbt.txt --out work/references_gbt.md
```

The script removes leading numeric labels, deduplicates by normalized title, places Chinese references first in pinyin order, and then sorts foreign references by first-author surname.

### 6. Insert Into a Manuscript

```powershell
python "<skill-dir>/scripts/insert_bibliography.py" article.docx work/references_gbt.md
```

Supported targets: `.md`, `.markdown`, `.txt`, and `.docx`. Convert legacy `.doc` files to `.docx` before insertion. The default output name ends in `_with_references`.

## Outputs

- `*_gbt.txt`: citations captured from the platform.
- `*_results.csv`: all matches and confidence values.
- `*_needs_review.csv`: failures and questionable records.
- `references_gbt.md`: deduplicated and sorted bibliography without numeric labels.
- `*_with_references.*`: a new manuscript with the bibliography appended.
