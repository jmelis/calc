# CLAUDE.md

A keyboard-driven SymPy calculator that runs entirely in the browser: SymPy in Pyodide (CPython
compiled to WebAssembly) in a Web Worker, results typeset with KaTeX, optional math input with
MathLive. A static site with no build step and no server, published at https://jmelis.github.io/calc/.

## Commands

```bash
make serve        # builds the bundle if needed, then serves http://127.0.0.1:8000 (file:// doesn't work)
make test         # uv run pytest; tests/test_latex.py also needs node, test_bundle.py the bundle
make bundle       # sympy-bytecode.zip: SymPy precompiled for the browser (tools/build_bundle.py)
uv sync           # dev env: sympy pinned to Pyodide's version, matplotlib, pytest
```

Deployment is `.github/workflows/pages.yml`: every push to `main` builds the bundle and runs the
tests, then publishes only the files the browser loads (`index.html`, `*.css`, `*.js`,
`py/calc/*.py`, `sympy-bytecode.zip`). A new top-level file the page needs must be added to that
workflow's copy step.

## Architecture

```
index.html ─ app.js ──messages──▶ backend.js ──postMessage──▶ worker.js (Pyodide) ──▶ py/calc/session.py
   (UI)        ▲                  (tape, IndexedDB,               (loads Pyodide,             (evaluates in one
               └──messages─────── worker lifecycle)                SymPy, py/calc/*)            namespace)
latex.js: math input's LaTeX → calculator text (page side)
```

| File | Role |
| --- | --- |
| `app.js` | All UI: tape, input (text `<input>` or MathLive `<math-field>`), palette, catalog, Memory panel, hover tips, keyboard handling |
| `latex.js` | LaTeX → calculator syntax, for the math input. Reads three dialects: what MathLive writes (`\frac37`, letters run together), what `preview.py` writes (when switching text → math), and what SymPy prints (results inserted from the tape) |
| `backend.js` | Plays the part a server would: keeps the tape, saves it and the pickled variables in IndexedDB, runs and restarts the worker, defers previews while computing |
| `worker.js` | Module worker: loads Pyodide and SymPy (with a byte-counted download for the progress bar), writes `py/calc/*.py` into Pyodide's filesystem, loads matplotlib on first `plot` |
| `tools/build_bundle.py` | Builds `sympy-bytecode.zip`: SymPy and mpmath from the exact wheels Pyodide ships, compiled to sourceless bytecode with docstrings stripped (`-OO`). The worker puts the zip on `sys.path` (zipimport); without it, it falls back to Pyodide's source packages |
| `py/calc/parser.py` | Calculator syntax → SymPy: `2x`, `sin x`, `^`, `5!`, `=` handling (assign / define / equation, also inside calls), `°`/`º`, `$n` |
| `py/calc/preview.py` | Input → LaTeX by walking the AST of the transformed source. Never evaluates, so it's cheap and safe on every keystroke, and shows what was typed (`integrate(…)` renders as ∫) |
| `py/calc/session.py` | The namespace and the API the worker calls: `run`, `preview`, `names`, `variables`, `forget`, `state`. Result views (exact / float / degrees), Python fallback, stdout capture, plots as PNGs |
| `py/calc/catalog.py`, `stats.py` | The `?` catalog (curated, not all of SymPy); `mean`/`median`/`variance`/`stdev`/`pvariance`/`pstdev` |

### Messages

Page → backend: `eval`, `preview` (`target`: `input`, `catalog`, `convert`), `interrupt`, `clear`,
`reset`, `vars`, `forget`. Backend → page: `init` (saved tape, before Python is up), `ready`
(catalog, names), `pending`, `entry`, `tape`, `preview`, `names`, `vars`, `status` (text, and a
`fraction` while starting up). The backend `structuredClone`s what it emits: the page mutates what
it receives, and that must not reach the saved tape.

Worker requests are `{id, op, ...}` (`init`, `run`, `preview`, `vars`, `forget`), answered in
arrival order, so requests sent before `init` finishes simply wait. Python returns JSON strings
(see `GLUE` in `worker.js`), which keeps Pyodide proxies out of the page.

### Behaviour worth knowing

- **Interrupt** (Ctrl+C) terminates the worker and starts a new one from the state saved after the
  last result. Interrupting Python in place needs SharedArrayBuffer, i.e. cross-origin isolation
  headers that GitHub Pages can't send.
- **Startup**: the saved tape shows immediately (the welcome screen only once the tape is known to
  be empty, so it doesn't flash); input submitted before Python is ready queues as "computing".
  Importing SymPy from source took ~2 s of a ~3 s warm reload, compiling it every time, hence the
  precompiled bundle (~5x faster import for ~3 MB more download: plain zip deflate was chosen over
  xz, which would need a decompressor in the browser and time on every load).
- **"computing"** only appears after 300 ms (a CSS animation delay), so fast results don't flash it.
- **Names** are whole words (sympy's `split_symbols` is deliberately not used): splitting made
  `xy` mean x·y until something named `xy` was defined, and hid `e` = 2.718… inside words. Results
  print multi-letter names upright (`session._LatexPrinter`, same rule as the preview's `_symbol`),
  so `velocity` doesn't read as a product and `x2` reads back as `x2`, not `x_2`.
- **Wrapping**: results are typeset inline with `\displaystyle` (inline math can break at `+`
  and `=`; display math can only overflow), collections arrive as separate `items` and render as a
  wrapping row, and long digit runs get `\allowbreak`. What still can't wrap (a wide matrix)
  scrolls from its left edge.
- **Deleting** (⌫ on a selected tape item) removes the entry from the tape only: its value stays
  reachable as `$n`.
- **Results** carry `latex`, `text` (single-line source, so picking a result can paste it back),
  optional `float` and `degrees` views, and a `label` for assignments. Objects that can't round-trip
  as text are inserted as `$n`.
- **Persistence** is IndexedDB (`calc` db, `kv` store: `tape`, `state`). The tape holds plot PNGs,
  which is why it isn't localStorage. Only names defined with calculator syntax (`a = …`,
  `f(x) = …`) are saved and shown by `:vars`.

## Conventions

- No build step, no framework, no npm dependencies: plain scripts loaded by `index.html`.
  Third-party code comes from jsDelivr with exact versions: Pyodide in `worker.js`, KaTeX in
  `index.html`, MathLive in `app.js`.
- **Keyboard first.** Every feature must work without the mouse; mouse controls (palette, buttons)
  never take focus from the input (`mousedown` → `preventDefault`). Keep the number of shortcuts
  small: in the tape, single letters act on the selection (`f`, `d`, `c`); everything else types.
- **Tips** (`setTip`): say what a control does, with an example when it helps. Don't repeat its
  label or the text it inserts (not "Factor: factor(…)").
- Palette entries are `[label, text template, math template, tip]`: `|` / `#0` mark the cursor (or
  wrap the selection), `#?` is an empty MathLive box. Commands live in the `COMMANDS` table.
- `py/calc/` stays plain Python with no browser dependencies; test it natively. Anything Pyodide-
  specific belongs in `worker.js`.
- Every user-visible feature gets a line in the catalog (`catalog.py`) or the hint line, so it can
  be discovered.

## Versions

- SymPy in the browser is whatever Pyodide ships. `PYODIDE_VERSION` in `worker.js` and the
  `sympy==` pin in `pyproject.toml` move together. When bumping Pyodide, also update the
  `RUNTIME` / `SOURCE_PACKAGES` sizes in `worker.js` (`curl -s --compressed URL | wc -c`; a stale
  size only makes the progress bar less accurate) and the wheel file names there.
- The bundle's bytecode is specific to Python's minor version: `tools/build_bundle.py` must run on
  the same one as Pyodide (it checks `pyodide-lock.json`), so `.python-version` follows Pyodide's
  Python too. It reads `PYODIDE_VERSION` from `worker.js`, so the wheels always match.
- `parser.py` carries a fixed copy of SymPy's private `_implicit_application` (upstream breaks
  `sin x^2` once `x` is defined) and imports other SymPy internals. A SymPy bump can break it; the
  tests will tell.

## Gotchas (learned the hard way)

- Pyodide must be loaded in a **module** worker (`import(…/pyodide.mjs)`): `importScripts` of the
  classic `pyodide.js` fails in Chrome. Import it inside the `init` request, not with a top-level
  `await`, or messages sent before the import finishes are lost.
- SymPy's tokenizer calls `bool()` on namespace values (fails for `Eq`), so `parser.to_python`
  tokenizes against a shadow namespace that only says whether each name is callable.
- MathLive: set options only after the `<math-field>` is in the DOM ("Mathfield not mounted").
  Its ~260 built-in inline shortcuts fire inside words (`int|egrate`, `exp|and` → `\exp\land`), so
  they're replaced by a curated set plus the catalog's function names (MathLive upgrades to the
  longest match, so `sin` → `sinh` works). `mathModeSpace` keeps spaces; `:=` and `\coloneqq` mean
  `=`.
- Focus: hiding the focused element (catalog search, text input on mode switch) makes Chrome move
  focus to `<body>` *after* our `focus()` call. Blur first and focus in `requestAnimationFrame`.
- KaTeX text copies badly (hidden MathML duplicates), so a `copy` handler swaps in a tape row's
  source text.
- `°` binds to the value just before it (`atan(1)/1°` is 45), and `º` (Option+0 on a Mac, easy to
  type by mistake) means the same.
- Results are shown with `=`, never `:=`: whatever the tape shows may be copied back as input.

## Testing in a browser

Run `make serve` (or `python3 -m http.server <port>` for a second instance) and drive it with
Claude in Chrome. The tape and variables live in that origin's IndexedDB, so testing on the same
host and port as the user's own session changes *their* tape: use a different port. To start
clean, call `backend.stopWorker()` and delete the `calc` database, then reload.

## Syntax reference

| Input | Meaning |
| --- | --- |
| `2x`, `sin x`, `x^2`, `5!` | Implicit multiplication/application, `^` is power |
| `xy`, `x2`, `velocity` | Names are whole words, defined or not; `x y` or `x*y` multiplies. An unknown multi-letter name called like a function is an error with a "did you mean" |
| `a = 3/7`, `a := 3/7` | Assign |
| `f(x) = x^2 + 1` | Define a function (a `Lambda`) |
| `x^2 = 4`, `solve(x^2 = 2, x)` | Other `=` is an equation, also inside calls (keyword arguments excepted) |
| `ans`, `$3` | Last result; result of entry 3. A leading `+ * / ^ -` continues from `ans` (`--5` types `-5`) |
| `sin(30°)` | Degrees |
| `e`, `I`, `pi`, `oo` | Constants (`e` is `E`) |
| `:vars`, `:clear`, `:reset` | Memory panel; empty the tape; also forget all variables |
| anything else | Run as plain Python (imports, loops) |

Keys: <kbd>⏎</kbd> evaluate (on an empty line: repeat the last entry), <kbd>↑</kbd>/<kbd>↓</kbd>
select tape items, <kbd>⏎</kbd> insert the selection, <kbd>f</kbd> exact/float, <kbd>d</kbd>
degrees, <kbd>c</kbd> copy LaTeX, <kbd>⌫</kbd> delete the entry, <kbd>Tab</kbd> complete, <kbd>?</kbd> catalog, <kbd>Ctrl</kbd>+
<kbd>C</kbd> interrupt, <kbd>Ctrl</kbd>+<kbd>M</kbd> math input.
