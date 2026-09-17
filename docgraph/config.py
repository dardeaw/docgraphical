import os
from typing import Optional


def get_default_repo_root() -> str:
    return os.getcwd()


def get_docgraph_dir(repo_path: Optional[str] = None) -> str:
    base = repo_path or get_default_repo_root()
    return os.path.join(base, ".docgraph")


def get_default_db_path(repo_path: Optional[str] = None) -> str:
    return os.path.join(get_docgraph_dir(repo_path), "docgraph.db")
