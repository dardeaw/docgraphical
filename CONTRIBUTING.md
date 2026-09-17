# Contributing to DocGraphical

Thank you for your interest in contributing to DocGraphical! We welcome bug fixes, documentation improvements, and architectural enhancements.

---

## Code of Conduct

We are committed to providing a welcoming, constructive, and collaborative environment. Please treat all contributors and maintainers with respect.

---

## Development Setup

### 1. Clone Repository & Setup Environment

```bash
git clone https://github.com/dardeaw/docgraphical.git
cd docgraphical
python -m venv .venv
source .venv/bin/activate  # Or .venv\Scripts\activate on Windows
pip install -e ".[dev,mcp]"
```

### 2. Running Test Suites

Before submitting any pull request, ensure all tests pass:

```bash
# Run Python unit tests
pytest

# Run Node.js tests
node test.js

# Check code formatting & linting
flake8 docgraphical tests --max-line-length=127
```

---

## Pull Request Guidelines

1. **Focused Scope**: Keep PRs focused on a single bug fix or feature.
2. **Test Coverage**: Add test cases in `tests/test_docgraphical.py` for any new parser or slicing behavior.
3. **Commit Messages**: Use concise, conventional commit prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
4. **Documentation**: Update documentation and docstrings if public API behavior changes.

---

## Reporting Issues

When reporting bugs, please provide:
- Python version and OS environment.
- Minimal reproducible Markdown snippet.
- Expected versus actual output.
