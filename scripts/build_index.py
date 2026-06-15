#!/usr/bin/env python3
import json
import re
import subprocess
import sys
from datetime import datetime
from html import escape
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SITE = "public"
INDEX = ROOT / SITE / "index.html"
HERE = Path(__file__).parent
TEMPLATE = (HERE / "index_template.html").read_text()
CFG = json.loads((HERE / "site.json").read_text())
VOCAB = json.loads((HERE / "tags.json").read_text())

AUTHOR_MAP = {}

TAG_RULES = []

IGNORE = {"index.html", ".DS_Store"}


def derive_tags(slug):
    return [tag for pat, tag in TAG_RULES if re.search(pat, slug)]


def git_added(path, follow):
    cmd = ["git", "log", "--diff-filter=A", "--format=%ad|%an", "--date=short"]
    if follow:
        cmd.append("--follow")
    out = subprocess.run(cmd + ["--", str(path)],
        cwd=ROOT, capture_output=True, text=True).stdout.strip().splitlines()
    if out:
        date_s, author = out[-1].split("|", 1)
        return datetime.strptime(date_s, "%Y-%m-%d").date(), AUTHOR_MAP.get(author, author)
    who = subprocess.run(["git", "config", "user.name"], cwd=ROOT,
                         capture_output=True, text=True).stdout.strip()
    return datetime.today().date(), AUTHOR_MAP.get(who, who or None)


def load_meta(meta_path, slug):
    d = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    if not d.get("title"):
        d["title"] = slug.replace("-", " ").title()
    return d


def collect():
    base = ROOT / SITE
    entries = []
    for child in sorted(base.iterdir()):
        if child.name in IGNORE or child.name.endswith("._meta.json"):
            continue
        if child.is_dir():
            href, meta_path, gitpath, follow = f"{quote(child.name)}/", child / "_meta.json", child, False
        elif child.suffix == ".html":
            href, meta_path, gitpath, follow = quote(child.name), base / f"{child.name}._meta.json", child, True
        else:
            continue
        date, author = git_added(gitpath, follow)
        meta = load_meta(meta_path, child.stem)
        tags = meta.get("tags") or derive_tags(child.stem)
        entries.append({**meta, "href": href, "date": date, "author": author,
                        "_meta_found": meta_path.exists(), "tags": tags})
    entries.sort(key=lambda e: (e["date"] or datetime.min.date()), reverse=True)
    return entries


def render(entries):
    months = {}
    for e in entries:
        key = e["date"].strftime("%Y-%m") if e["date"] else "0000-00"
        months.setdefault(key, []).append(e)

    blocks = []
    for key in sorted(months, reverse=True):
        label = datetime.strptime(key, "%Y-%m").strftime("%B %Y") if key != "0000-00" else "Undated"
        rows = []
        for e in months[key]:
            day = e["date"].strftime("%-d %b") if e["date"] else "—"
            pill = '<span class="pill">confidential</span>' if e.get("confidential") else ""
            desc = f'<p class="desc">{escape(e["desc"])}</p>' if e.get("desc") else ""
            by = f'<span class="by">{escape(e["author"])}</span>' if e.get("author") else ""
            meta = escape(day) + (" · " + by if by else "")
            data_tags = escape(" ".join(e.get("tags", [])))
            rows.append(
                f'      <a class="row" data-tags="{data_tags}" href="{escape(e["href"])}">\n'
                f'        <div class="row-main"><h3>{escape(e["title"])}{pill}</h3>{desc}</div>\n'
                f'        <div class="row-meta">{meta}</div>\n'
                f'      </a>')
        head = (f'      <div class="month-head"><span>{escape(label)}</span>'
                f'<span class="count">{len(rows)}</span></div>')
        blocks.append('    <section class="month">\n' + head + '\n' + "\n".join(rows) + '\n    </section>')

    counts = {}
    for e in entries:
        for t in e.get("tags", []):
            counts[t] = counts.get(t, 0) + 1
    ordered = [t for t in VOCAB if t in counts] + [t for t in sorted(counts) if t not in VOCAB]
    chips = [f'<button class="chip is-active" data-tag="">All <i>{len(entries)}</i></button>']
    for t in ordered:
        chips.append(f'<button class="chip" data-tag="{escape(t)}">{escape(t)} <i>{counts[t]}</i></button>')
    filterbar = f'    <nav class="filters">{"".join(chips)}</nav>' if counts else ""

    repl = {
        "__STAMP__": escape(CFG.get("stamp", "")),
        "__HEADING__": escape(CFG.get("heading", "Documents")),
        "__SUB__": escape(CFG.get("sub", "")),
        "__FOOTER__": escape(CFG.get("footer", "")),
        "__FILTERS__": filterbar,
        "__BODY__": "\n".join(blocks),
        "__COUNT__": str(len(entries)),
    }
    html = TEMPLATE
    for k, v in repl.items():
        html = html.replace(k, v)
    return html


def validate(entries):
    errors, warnings = [], []
    allowed = set(VOCAB)
    for e in entries:
        slug = e["href"].strip("/")
        for t in e.get("tags", []):
            if t not in allowed:
                errors.append(f"{slug}: unknown tag {t!r} (allowed: {', '.join(sorted(allowed))})")
        if not e.get("_meta_found"):
            warnings.append(f"{slug}: no _meta.json — using fallback title/no description")
    return errors, warnings


def main():
    check = "--check" in sys.argv
    entries = collect()
    html = render(entries)
    errors, warnings = validate(entries)
    if check:
        if not INDEX.exists() or INDEX.read_text() != html:
            errors.append(f"{SITE}/index.html is stale — run build_index.py")
    else:
        INDEX.write_text(html)
        print(f"{SITE}: {len(entries)} entries -> {SITE}/index.html")
    for w in warnings:
        print(f"  warn: {w}", file=sys.stderr)
    if errors:
        for er in errors:
            print(f"  ERROR: {er}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
