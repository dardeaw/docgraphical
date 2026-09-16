"""DocGraph - Precision Markdown AST, TOC Outline & Section Extraction Engine.

Designed for AI Coding Agents and developers to read long Markdown specs with surgical precision,
saving up to 97% context tokens.
"""

__version__ = "1.0.0"
__author__ = "Chunghsing Tech / CodeGraph Team"

from .parser import extract_toc, extract_section, search_doc, parse_headings

__all__ = [
    "__version__",
    "extract_toc",
    "extract_section",
    "search_doc",
    "parse_headings",
]
