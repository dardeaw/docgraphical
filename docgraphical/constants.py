"""Constants and default configuration for DocGraphical."""
import os

IGNORE_DIRS = {
    ".git", ".codegraph", "node_modules", "dist", "build", ".venv", "venv", "env",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".idea", ".vscode", "target", "vendor"
}

DOC_EXTS = (".md", ".markdown", ".mdown", ".txt")

CONFIG_FILE = os.path.expanduser("~/.docgraphical_config.json")
DEFAULT_PORT = 5002
DEFAULT_HOST = "127.0.0.1"
