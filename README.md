# cppslash

A tiny twoslash-like helper for Shiki + clangd to render C/C++ code with inline diagnostics and hover info.

Features
- Launches `clangd` as an LSP server.
- Reads special inline markers in comments to request hovers (e.g. `// ^?`).
- Collects `textDocument/publishDiagnostics` diagnostics from clangd.
- Uses `shiki` to syntax-highlight and outputs an HTML snippet with annotations.

Quick start (local)
1. Install clangd (>= 14 recommended). On macOS with brew: `brew install llvm` and ensure `clangd` in PATH or set path explicitly.
2. Clone this project and run:
   npm install
   npm run build
3. CLI usage:
   node dist/cli.js -i example/example.cpp -o out.html

Library usage (programmatic)
- import { render } from 'cppslash' and call `render(code, { fileName: 'foo.cpp' })` to get HTML string.

Markers supported
- `// ^?` placed at the end of a line — requests a hover at previous token.
- Diagnostics from clangd will be shown as annotations below the code.

Notes
- clangd must be installed; the package launches clangd as a child process.
- This is a lightweight implementation and does not attempt full-language-server features (no workspace indexing handling, etc.)