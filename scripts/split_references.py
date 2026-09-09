#!/usr/bin/env python3
"""
Split a mixed reference list into source-specific work queues:
- English academic references -> Google Scholar browser crawler
- Chinese academic references -> CNKI export / CNKI crawler
- Policy / standards / official documents -> policy CSV
"""

from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from pathlib import Path


CJK_RE = re.compile(r"[\u3400-\u9fff]")
YEAR_RE = re.compile(r"(19|20)\d{2}")


@dataclass
class Item:
    key: str
    title: str
    authors: str = ""
    year: str = ""
    raw: str = ""
    section: str = ""
    kind: str = ""


def clean(value: str) -> str:
    value = re.sub(r"[*_`]+", "", value or "")
    return re.sub(r"\s+", " ", value).strip()


def has_cjk(value: str) -> bool:
    return bool(CJK_RE.search(value or ""))


def parse_markdown(path: Path) -> list[Item]:
    items: list[Item] = []
    section = ""
    for line_no, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        raw = line.strip()
        if not raw:
            continue
        if raw.startswith("#"):
            section = raw.strip("# ").strip()
            continue
        if raw.endswith("：") and len(raw) < 80:
            section = raw.rstrip("：")
            continue
        item = parse_line(raw, key=str(line_no), section=section)
        if item.title:
            items.append(item)
    return items


def parse_line(raw: str, key: str, section: str) -> Item:
    item = Item(key=key, title="", raw=raw, section=section)

    m = re.match(r"^(?P<authors>.+?)\.\s*\((?P<year>\d{4})\)\.\s*(?P<rest>.+)$", raw)
    if m:
        item.authors = clean(m.group("authors"))
        item.year = m.group("year")
        rest = clean(m.group("rest"))
        title = rest
        if "arXiv:" in rest:
            title = rest.split("arXiv:", 1)[0].strip(" .")
        else:
            parts = re.split(r"\.\s+", rest, maxsplit=1)
            title = parts[0].strip(" .")
        item.title = clean(title)
        item.kind = classify(item)
        return item

    # GB/T-ish fallback.
    m = re.match(r"^(?P<authors>.+?)\.\s*(?P<title>.+?)\[[A-Z/]+\]", raw)
    if m:
        item.authors = clean(m.group("authors"))
        item.title = clean(m.group("title"))
        ym = YEAR_RE.search(raw)
        if ym:
            item.year = ym.group(0)
        item.kind = classify(item)
        return item

    # Policy or simple title line fallback.
    if YEAR_RE.search(raw) or has_cjk(raw):
        item.title = clean(re.sub(r"^\d+[\.\)]\s*", "", raw).strip(" ."))
        ym = YEAR_RE.search(raw)
        if ym:
            item.year = ym.group(0)
        item.kind = classify(item)
    return item


def classify(item: Item) -> str:
    text = f"{item.section} {item.authors} {item.title} {item.raw}"
    official_authors = ["中共中央", "国务院", "新华社", "全国人民代表大会", "教育部", "中华人民共和国教育部"]
    official_like = any(word in item.authors or word in item.raw for word in official_authors)
    policy_title = any(word in item.title for word in ["纲要", "意见", "指南", "指引", "行动计划", "讲话"])
    course_standard_body = (
        "课程标准" in item.title
        and official_like
        and not any(word in item.title for word in ["修订", "解读", "研究", "核心素养"])
    )
    if "政策" in item.section or policy_title or course_standard_body:
        return "policy"
    if "学术文献" in item.section and has_cjk(item.title):
        return "zh"
    if has_cjk(item.title) or has_cjk(item.authors):
        return "zh"
    return "en"


def write_outputs(items: list[Item], out_dir: Path, exclude_section: str = "") -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    if exclude_section:
        pattern = re.compile(exclude_section)
        items = [item for item in items if not pattern.search(item.section)]
    en = [item for item in items if item.kind == "en"]
    zh = [item for item in items if item.kind == "zh"]
    policy = [item for item in items if item.kind == "policy"]

    write_query_txt(out_dir / "scholar_en_queries.txt", en)
    write_query_txt(out_dir / "cnki_zh_queries.txt", zh)
    write_policy_csv(out_dir / "policy_refs.csv", policy)
    write_manifest(out_dir / "split_manifest.csv", items)


def write_query_txt(path: Path, items: list[Item]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for item in items:
            f.write(f"{item.key}\t{item.title}\n")


def write_policy_csv(path: Path, items: list[Item]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["key", "type", "authors", "year", "title", "publisher", "place", "url", "raw"])
        writer.writeheader()
        for item in items:
            writer.writerow(
                {
                    "key": item.key,
                    "type": guess_policy_type(item),
                    "authors": item.authors,
                    "year": item.year,
                    "title": item.title,
                    "publisher": "",
                    "place": "",
                    "url": "",
                    "raw": item.raw,
                }
            )


def guess_policy_type(item: Item) -> str:
    if "讲话" in item.title or "新华社" in item.authors:
        return "EB/OL"
    if "课程标准" in item.title and "教育部" in item.authors:
        return "M"
    return "Z"


def write_manifest(path: Path, items: list[Item]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["key", "kind", "authors", "year", "title", "section", "raw"])
        writer.writeheader()
        for item in items:
            writer.writerow(item.__dict__)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Split mixed references into Scholar/CNKI/policy work queues.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--out", type=Path, default=Path("reference_pipeline/queues"))
    parser.add_argument("--exclude-section", default="", help="Regex for sections to exclude, e.g. 备用文献|统计信息")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.input.suffix.lower() not in {".md", ".markdown"}:
        raise SystemExit("Currently split_references.py supports markdown reference lists.")
    items = parse_markdown(args.input)
    if args.exclude_section:
        pattern = re.compile(args.exclude_section)
        items = [item for item in items if not pattern.search(item.section)]
    write_outputs(items, args.out)
    counts = {kind: sum(1 for item in items if item.kind == kind) for kind in ["en", "zh", "policy"]}
    print(f"Split {len(items)} references: en={counts['en']}, zh={counts['zh']}, policy={counts['policy']}")
    print(f"Wrote queues to: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
