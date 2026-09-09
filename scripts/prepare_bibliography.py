#!/usr/bin/env python3
"""Deduplicate and sort one-line GB/T 7714 bibliography entries."""

from __future__ import annotations

import argparse
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path


CJK_RE = re.compile(r"[\u3400-\u9fff]")
NUMBER_RE = re.compile(r"^\s*\[\d+\]\s*")
TYPE_RE = re.compile(r"\[(?:J|M|N|D|R|S|Z|P|A|C|DB|CP|EB|DS|SW)(?:/OL)?\]", re.I)


@dataclass
class Entry:
    text: str
    author: str
    title: str
    source: str


def clean_line(line: str) -> str:
    return NUMBER_RE.sub("", line.strip())


def parse_entry(line: str, source: Path) -> Entry | None:
    text = clean_line(line)
    if not text or text.startswith("#") or text.startswith("【"):
        return None
    marker = TYPE_RE.search(text)
    first_dot = text.find(".")
    if not marker or first_dot < 1 or first_dot >= marker.start():
        return None
    return Entry(
        text=text,
        author=text[:first_dot].strip(),
        title=text[first_dot + 1 : marker.start()].strip(),
        source=str(source),
    )


def normalize_key(value: str) -> str:
    return "".join(ch.lower() for ch in unicodedata.normalize("NFKC", value) if ch.isalnum())


def latin_sort_key(value: str) -> str:
    folded = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in folded if not unicodedata.combining(ch)).casefold()


def chinese_sort_key(value: str) -> str:
    try:
        from pypinyin import Style, lazy_pinyin

        return " ".join(lazy_pinyin(value, style=Style.NORMAL, errors=lambda chars: list(chars))).casefold()
    except ImportError:
        return value.casefold()


def entry_sort_key(entry: Entry, foreign_first: bool) -> tuple[int, str, str]:
    chinese = bool(CJK_RE.search(entry.author))
    language_rank = (1 if chinese else 0) if foreign_first else (0 if chinese else 1)
    author_key = chinese_sort_key(entry.author) if chinese else latin_sort_key(entry.author)
    return language_rank, author_key, latin_sort_key(entry.title)


def read_entries(paths: list[Path]) -> list[Entry]:
    entries: list[Entry] = []
    for path in paths:
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            entry = parse_entry(line, path)
            if entry:
                entries.append(entry)
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description="Deduplicate and alphabetize GB/T 7714 references.")
    parser.add_argument("inputs", nargs="+", type=Path, help="UTF-8 .txt or .md bibliography files")
    parser.add_argument("--out", type=Path, default=Path("references_gbt.md"))
    parser.add_argument("--numbered", action="store_true", help="Add [1], [2]... labels")
    parser.add_argument("--foreign-first", action="store_true", help="Place foreign references before Chinese references")
    args = parser.parse_args()

    missing = [str(path) for path in args.inputs if not path.exists()]
    if missing:
        raise SystemExit("Input file not found: " + ", ".join(missing))

    entries = read_entries(args.inputs)
    unique: dict[str, Entry] = {}
    for entry in entries:
        key = normalize_key(entry.title)
        if key and key not in unique:
            unique[key] = entry

    ordered = sorted(unique.values(), key=lambda item: entry_sort_key(item, args.foreign_first))
    lines = []
    for index, entry in enumerate(ordered, start=1):
        prefix = f"[{index}] " if args.numbered else ""
        lines.append(prefix + entry.text)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text("# 参考文献\n\n" + "\n\n".join(lines) + "\n", encoding="utf-8")
    print(f"Read {len(entries)} entries; wrote {len(ordered)} unique entries to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
