# Contributing to DocGraphical

Thank you for your interest in contributing to DocGraphical. We welcome contributions from the community to help make documentation parsing faster, more precise, and more efficient for AI agents and human developers alike.

---

## Code of Conduct

We expect all contributors and maintainers to adhere to principles of mutual respect, constructive collaboration, and technical integrity.

---

## Development Workflow

### 1. Fork & Clone Repository

```bash
git clone https://github.com/dardeaw/docgraphical.git
cd docgraphical
```

### 2. Setup Python Environment

```bash
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux / macOS:
source .venv/bin/activate

pip install -e ".[dev,mcp]"
```

### 3. Setup Node.js Environment

```bash
npm install
```

### 4. Running Test Suites

All submissions must pass both Python and Node.js test suites:

```bash
# Run Python unit tests
pytest tests/

# Run Node.js tests
npm test
```

---

## Pull Request Guidelines

1. **Focused Changes**: Keep pull requests focused on a single feature, bugfix, or improvement.
2. **Deterministic Code**: Ensure all parsing logic maintains strict state-machine determinism without introducing heuristic approximations.
3. **Zero New External Dependencies**: The core parser must remain free of external dependencies.
4. **Documentation**: Update both English (`README.md`, `ARCHITECTURE.md`) and Traditional Chinese (`README.zh-TW.md`, `ARCHITECTURE.zh-TW.md`) documentation when introducing new features or altering CLI behaviors.

---

## License

By submitting code to DocGraphical, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
