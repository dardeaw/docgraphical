"""DocGraph Markdown Parsing & Extraction Engine."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class HeadingNode:
    level: int
    title: str
    line_number: int
    raw_line: str


def parse_headings(file_path: str) -> List[HeadingNode]:
    """Parse all headings (# ... ######) from a Markdown file, ignoring code blocks."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    headings: List[HeadingNode] = []
    in_code_block = False

    for idx, line in enumerate(lines, 1):
        stripped = line.strip()

        # Handle fenced code block guards
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            continue

        if in_code_block:
            continue

        # Match ATX headings: # Title
        m = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if m:
            level = len(m.group(1))
            title = m.group(2).strip()
            # Clean trailing hashes if any
            title = re.sub(r"\s+#+$", "", title)
            headings.append(HeadingNode(level=level, title=title, line_number=idx, raw_line=line))

    return headings


def extract_toc(file_path: str, format_type: str = "text") -> str:
    """Extract Table of Contents (TOC) with line number anchors.

    format_type: 'text' (indented tree), 'json', or 'markdown'
    """
    try:
        headings = parse_headings(file_path)
    except Exception as e:
        return f"Error: {e}"

    if not headings:
        return f"[DocGraph] No Markdown headings found in {os.path.basename(file_path)}"

    if format_type == "json":
        import json
        data = [
            {"level": h.level, "title": h.title, "line": h.line_number}
            for h in headings
        ]
        return json.dumps(data, indent=2, ensure_ascii=False)

    elif format_type == "markdown":
        lines = [f"## Table of Contents: {os.path.basename(file_path)}\n"]
        for h in headings:
            indent = "  " * (h.level - 1)
            lines.append(f"{indent}- [{h.title}](#line-{h.line_number}) *(Line {h.line_number})*")
        return "\n".join(lines)

    else:  # default text tree
        lines = [f"=== [DocGraph TOC] {os.path.basename(file_path)} ==="]
        for h in headings:
            indent = "  " * (h.level - 1)
            hashes = "#" * h.level
            lines.append(f"[Line {h.line_number:4d}] {indent}{hashes} {h.title}")
        return "\n".join(lines)


def extract_section(
    file_path: str,
    target_heading: str,
    include_subsections: bool = True
) -> str:
    """Surgically extract a specific section by heading title."""
    if not os.path.exists(file_path):
        return f"Error: File not found: {file_path}"

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        lines = f.readlines()

    target_clean = target_heading.strip().lower().lstrip("#").strip()
    matched_idx = -1
    matched_level = -1
    in_code_block = False

    # Find the target heading line
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            continue
        if in_code_block:
            continue

        m = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if m:
            level = len(m.group(1))
            title = m.group(2).strip().lower()
            title = re.sub(r"\s+#+$", "", title)
            if target_clean in title or target_clean == title:
                matched_idx = idx
                matched_level = level
                break

    if matched_idx == -1:
        return f"Error: Heading '{target_heading}' not found in {os.path.basename(file_path)}"

    section_lines = [lines[matched_idx]]
    in_code_block = False

    for idx in range(matched_idx + 1, len(lines)):
        line = lines[idx]
        stripped = line.strip()

        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code_block = not in_code_block
            section_lines.append(line)
            continue

        if not in_code_block:
            m = re.match(r"^(#{1,6})\s+(.+)$", stripped)
            if m:
                level = len(m.group(1))
                if include_subsections:
                    if level <= matched_level:
                        break
                else:
                    if level <= matched_level or level > matched_level:
                        break

        section_lines.append(line)

    result_text = "".join(section_lines).strip()
    header_banner = f"<!-- [DocGraph Section] {os.path.basename(file_path)} | Line {matched_idx + 1} -->\n"
    return f"{header_banner}{result_text}"


def search_doc(
    path: str,
    query: str,
    max_results: int = 30
) -> str:
    """Search Markdown file or directory for relevant sections or lines."""
    if not os.path.exists(path):
        return f"Error: Path not found: {path}"

    md_files: List[str] = []
    if os.path.isfile(path):
        md_files.append(path)
    else:
        for root, _, files in os.walk(path):
            # Ignore hidden or vendor directories
            if any(part.startswith(".") or part in ("node_modules", "dist", "build", "__pycache__") for part in root.split(os.sep)):
                continue
            for file in files:
                if file.lower().endswith((".md", ".markdown", ".mdown")):
                    md_files.append(os.path.join(root, file))

    if not md_files:
        return f"No Markdown files found in {path}"

    results: List[str] = []
    query_clean = query.strip().lower()

    for mf in md_files:
        try:
            with open(mf, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()

            for idx, line in enumerate(lines, 1):
                if query_clean in line.lower():
                    rel_path = os.path.relpath(mf, path) if os.path.isdir(path) else os.path.basename(mf)
                    snippet = line.strip()
                    if len(snippet) > 120:
                        snippet = snippet[:117] + "..."
                    results.append(f"- **{rel_path}** [L{idx}]: `{snippet}`")
                    if len(results) >= max_results:
                        break
            if len(results) >= max_results:
                break
        except Exception:
            continue

    if not results:
        return f"No matches found for '{query}' in {len(md_files)} Markdown file(s)."

    header = f"=== [DocGraph Search] Matches for '{query}' ({len(results)} found) ===\n"
    return header + "\n".join(results)
