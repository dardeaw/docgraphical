"""Unit and Integration Tests for DocGraph."""

import os
import tempfile
import pytest
from docgraph.parser import parse_headings, extract_toc, extract_section, search_doc

SAMPLE_MD = """# Project Title

Introductory paragraph here.

## 1. System Architecture
Overview of the system architecture.

### 1.1 Core Engine
Details of the core engine.

```python
# This is a python comment, not a markdown heading
def hello():
    return "world"
```

### 1.2 Memory Model
Details about the memory model.

## 2. Installation Guide
Run the following command:
`pip install docgraph`

## 3. License
MIT License
"""

@pytest.fixture
def temp_md_file():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".md", delete=False, encoding="utf-8") as f:
        f.write(SAMPLE_MD)
        path = f.name
    yield path
    if os.path.exists(path):
        os.remove(path)


def test_parse_headings(temp_md_file):
    headings = parse_headings(temp_md_file)
    assert len(headings) == 6
    assert headings[0].title == "Project Title"
    assert headings[0].level == 1
    assert headings[1].title == "1. System Architecture"
    assert headings[1].level == 2
    # Verify python comment inside codeblock was NOT parsed as heading
    titles = [h.title for h in headings]
    assert "This is a python comment, not a markdown heading" not in titles


def test_extract_toc(temp_md_file):
    toc = extract_toc(temp_md_file)
    assert "[DocGraph TOC]" in toc
    assert "# Project Title" in toc
    assert "## 1. System Architecture" in toc
    assert "### 1.1 Core Engine" in toc


def test_extract_toc_json(temp_md_file):
    import json
    toc_json = extract_toc(temp_md_file, format_type="json")
    data = json.loads(toc_json)
    assert len(data) == 6
    assert data[1]["title"] == "1. System Architecture"


def test_extract_section(temp_md_file):
    sec = extract_section(temp_md_file, "1. System Architecture")
    assert "## 1. System Architecture" in sec
    assert "### 1.1 Core Engine" in sec
    assert "### 1.2 Memory Model" in sec
    # Section 2 should NOT be included
    assert "## 2. Installation Guide" not in sec


def test_extract_section_no_subsections(temp_md_file):
    sec = extract_section(temp_md_file, "1. System Architecture", include_subsections=False)
    assert "## 1. System Architecture" in sec
    assert "Overview of the system architecture." in sec
    # Subsections should NOT be included
    assert "### 1.1 Core Engine" not in sec


def test_search_doc(temp_md_file):
    res = search_doc(temp_md_file, "pip install")
    assert "pip install docgraph" in res


def test_missing_heading(temp_md_file):
    sec = extract_section(temp_md_file, "Nonexistent Section")
    assert "not found" in sec.lower()
