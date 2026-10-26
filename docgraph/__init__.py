# DocGraphical Package Entry
from .parser import parse_headings, extract_toc, extract_section, search_doc

search_file = search_doc

__version__ = "1.7.0"
__all__ = [
    "parse_headings",
    "extract_toc",
    "extract_section",
    "search_doc",
    "search_file",
]
