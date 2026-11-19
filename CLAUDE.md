# CLAUDE.md

A keyboard-driven SymPy calculator that runs entirely in the browser: SymPy in Pyodide (CPython
compiled to WebAssembly) in a Web Worker, results typeset with KaTeX, optional math input with
MathLive, and a calculator keypad on phones and tablets. A static site with no build step and no
server, published at https://jmelis.github.io/calc/.

## Commands

```bash
make serve        # builds the bundle if needed, then serves http://127.0.0.1:8000 (file:// doesn't work)
make test         # uv run pytest; test_latex.py and test_roundtrip_fuzz.py (random expressions typeset and read back) also need node, test_bundle.py the bundle, test_keypad.py node's Playwright
make bundle       # sympy-bytecode.zip, plot-bytecode.zip: precompiled for the browser (tools/build_bundle.py)
uv sync           # dev env: sympy pinned to Pyodide's version, matplotlib, pytest
```

Deployment is `.github/workflows/pages.yml`: every push to `main` builds the bundles and runs the
tests, then publishes only the files the browser loads (`index.html`, `*.css`, `*.js`,
`menus.json`, `py/calc/*.py`, `sympy-bytecode.zip`, `plot-bytecode.zip`, `manifest.webmanifest`,
`icon-*.png`).
A new top-level file the page needs must be added to that workflow's copy step
(`tests/test_site.py` fails until it is).

Add to Home Screen (iOS, Android) runs it as an app of its own: `manifest.webmanifest` plus the
`apple-mobile-web-app-*` metas in `index.html`'s head, and `icon-*.png` from `tools/make_icons.py`
(iOS won't take the SVG favicon). Nothing is cached offline: Pyodide still comes from the CDN.

GitHub Pages caches for 10 minutes, so the deploy stamps `index.html`'s local `src`/`href` with
the commit (`app.js?v=<sha>`); `backend.js` passes its own `?v=` on to `worker.js`, and the worker
to `py/calc/*.py`; keypad.js fetches `menus.json` with it too. The bundles are stamped with `PYODIDE_VERSION` instead, so they stay cached
across deploys. A new local script or stylesheet in `index.html` is stamped automatically if it's
named `name.js` or `name.css`. The footer shows the stamp's commit, linked to it on GitHub
(`renderAbout`; "local" without a stamp), next to a link to the source.

## Architecture

```
index.html ─ app.js ──messages──▶ backend.js ──postMessage──▶ worker.js (Pyodide) ──▶ py/calc/session.py
   (UI)        ▲                  (tape, IndexedDB,               (loads Pyodide,             (evaluates in one
               └──messages─────── worker lifecycle)                SymPy, py/calc/*)            namespace)
latex.js: math input's LaTeX → calculator text (page side)
keypad.js + touch.css: the touch layout, on top of app.js (only with <html class="touch">); its views take app.js's `panels`
menus.json: the keypad's soft menus (data only, fetched by keypad.js)
```

| File | Role |
| --- | --- |
| `app.js` | All UI: tape, input (text `<input>` or MathLive `<math-field>`), hint line, hover tips, keyboard handling, `insertKey` (the keypad's function keys), and the panels: catalog, Memory (`:vars`), Help. `panels` holds their openers, which the touch layout replaces with its views; what they list and do is shared (`catalogItems`, `renderCatalogEntry`, `insertCatalogEntry`, `memoryState`, `requestVariables`, `forgetVariable`, `insertName`) |
| `menus.json` | The keypad's soft menus, meant to be edited by hand (its `about` says how): `top` (what the menu key shows), `menus` by name (rows of five: F1–F5, then shift F1–F5, more rows for more pages; `null` an empty slot) and `keys` (what a name inserts: `label` or `tex`, `insert` with `\|` the cursor, `math`; a function needs no entry). A name is a menu, a view (`vars`, `catalog`, `help`, `setup`) or a key. The trig key opens `trig`, shift trig `hyp`, shift = `test`. `tests/test_menus.py` checks every name resolves. `tools/menus.html` edits it by drag and drop (under `make serve`; not deployed), and writes it in the same layout (`format`) |
| `latex.js` | LaTeX → calculator syntax, for the math input. Reads three dialects: what MathLive writes (`\frac37`, letters run together), what `preview.py` writes (when switching text → math), and what SymPy prints (results inserted from the tape) |
| `keypad.js` | The touch layout: a screen (status line, tape, input, two rows of soft key labels) over 40 equal keys (`KEYPAD`, five by eight, the soft keys F1–F5 its first row) with shift and alpha, the soft menus read from `menus.json`, `abc` (system keyboard), and the views that take the screen over (`VIEWS`: setup, vars, the catalog with its help pages, help) in place of app.js's panels. Drives app.js's own functions; does nothing without `html.touch` |
| `touch.css` | The touch layout's styles, one look (graphite keys, an LCD, the same by day and by night), every rule under `html.touch` (or `#keypad`, `.screen`, which only exist there) |
| `graph.js` | `iplot` graphs on the tape: draws Python's samples with uPlot (fetched on the first graph), asks for new samples when zoomed or panned, keys for a selected graph, x = 0 and y = 0 drawn under the curves (`drawAxisLines`) |
| `backend.js` | Plays the part a server would: keeps the tape, saves it and the pickled variables in IndexedDB, runs and restarts the worker, defers previews while computing, keeps the undo stack |
| `worker.js` | Module worker: loads Pyodide and SymPy (with a byte-counted download for the progress bar), writes `py/calc/*.py` into Pyodide's filesystem, loads matplotlib on the first `plot` (or as soon as one is typed) |
| `tools/build_bundle.py` | Builds `sympy-bytecode.zip`: SymPy and mpmath from the exact wheels Pyodide ships, compiled to sourceless bytecode with docstrings stripped (`-OO`). The worker puts the zip on `sys.path` (zipimport); without it, it falls back to Pyodide's source packages. Also `plot-bytecode.zip`: the same for matplotlib and its dependencies, as `__pycache__/*.pyc` unpacked over the installed packages (their extension modules can't load from a zip) |
| `py/calc/parser.py` | Calculator syntax → SymPy: `2x`, `sin x`, `^`, `5!`, `=` handling (assign / define / equation, also inside calls), `°`/`º`, `$n` |
| `py/calc/preview.py` | Input → LaTeX by walking the AST of the transformed source. Never evaluates, so it's cheap and safe on every keystroke, and shows what was typed (`integrate(…)` renders as ∫) |
| `py/calc/session.py` | The namespace and the API the worker calls: `run`, `preview`, `names`, `variables`, `forget`, `state`. Result views (exact / float / degrees), Python fallback, stdout capture, plots as PNGs. `plt` is matplotlib's pyplot for plotting data, a `_LazyModule` so nothing is imported until it's used |
| `py/calc/graphs.py` | `iplot`: samples expressions with numpy (mpmath for what numpy lacks), gaps at poles, a y range that ignores spikes; `sample_text` resamples for the page. A range is `(x, a, b)` or `[x, a, b]` (`_is_range`: a list is otherwise several expressions) |
| `py/calc/matrices.py` | `M[…]` and `V[…]`: matrices and column vectors, and how they print back as text |
| `py/calc/catalog.py`, `stats.py` | The `?` catalog (curated, not all of SymPy), each entry with its related ones (`SEE_ALSO`: the help pages' links); `mean`/`median`/`variance`/`stdev`/`pvariance`/`pstdev` |

### Messages

Page → backend: `eval`, `preview` (`target`: `input`, `catalog`, `convert`), `interrupt`, `clear`,
`delete`, `reset`, `vars`, `forget`, `undo`, `sample`. Backend → page: `init` (saved tape, before Python is
up), `ready` (catalog, names), `pending`, `entry`, `tape`, `preview`, `names`, `vars`, `undone`
(text to flash), `samples`, `status` (text, and a `fraction` while starting up). The backend `structuredClone`s what it emits: the page mutates what
it receives, and that must not reach the saved tape.

Worker requests are `{id, op, ...}` (`init`, `run`, `preview`, `vars`, `forget`, `unforget`, `sample`), answered in
arrival order, so requests sent before `init` finishes simply wait. Python returns JSON strings
(see `GLUE` in `worker.js`), which keeps Pyodide proxies out of the page.

### Behaviour worth knowing

- **Interrupt** (Ctrl+C) terminates the worker and starts a new one from the state saved after the
  last result. Interrupting Python in place needs SharedArrayBuffer, i.e. cross-origin isolation
  headers that GitHub Pages can't send.
- **Startup**: the saved tape shows immediately; input submitted before Python is ready queues as
  "computing". An empty tape shows nothing: the hint line (and the footer's `:help`), or on touch the
  status line's "menu: the menus, and help", say where to start.
  Importing SymPy from source took ~2 s of a ~3 s warm reload, compiling it every time, hence the
  precompiled bundle (~5x faster import for ~3 MB more download: plain zip deflate was chosen over
  xz, which would need a decompressor in the browser and time on every load).
- **Graphs** (`iplot`): the output carries the expressions (`srepr`), so after zooming or panning
  `graph.js` asks the worker to `sample` the new range (debounced, `seq` drops stale replies); it
  works after a restart or reload with nothing kept in Python. x is sent as `[from, to, n]`. Only
  numpy is loaded (~0.5 s the first time), and only numpy's part of `plot-bytecode.zip` is unpacked.
  Drag pans (Shift+drag is uPlot's zoom-to-range, `cursor.drag.x` set per press); a plain wheel
  scrolls the tape, a sideways swipe or Shift+wheel pans, Ctrl+wheel (a trackpad pinch) zooms.
- **Plotting** (`plot`, a matplotlib PNG): matplotlib (~13 MB) is fetched once something plots, or as
  soon as `plot` appears in the input (a preview with `target: "input"`), so it's usually ready by ⏎. Its bytecode comes from
  `plot-bytecode.zip`, and `warm_up_plotting` draws a throwaway plot so the first real one costs
  what any other does (~0.1 s, against ~2 s of compiling and first-time setup before).
- **Preview** (above the input): takes no room while the input is empty; its room opens with
  a line's first keystroke and stays until ⏎ or Esc, so the composer moves once per line, not per
  keystroke. An unfinished line (`1/100+`) keeps the last preview, dimmed.
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
- **Undo** (Ctrl+Z, when the input is empty or a tape item is selected; with text it's the input's
  own undo) takes back the last delete, `:clear` or forgotten variable. The backend keeps the stack
  in memory (a reload empties it); a forgotten value comes back from a pickle `forget` returned.
  Evaluations aren't undoable and `:reset` empties the stack.
- **Matrices** (`matrices.py`): `M` and `V` are plain objects in the namespace whose indexing builds
  a SymPy `Matrix` (`M[1, 2]` a row, `M[[1, 2], [3, 4]]` rows, `V[1, 2]` a column), so the parser
  knows nothing about them; the preview draws them (`_Renderer.makers`, only while `M`/`V` are the
  makers). Results print back as `M[…]`/`V[…]` (`matrix_text`). They live in the session's
  namespace, not only `_GLOBALS`: sympy's `auto_symbol` turns a global that isn't callable or
  `Basic` into a `Symbol`. Lists are plain Python lists (an earlier attempt made `[…]` do vector
  math; it was more magic than it was worth).
- **Setting parts** (`A[0, 1] = 5`, `A[1, :] = M[7, 8]`, `v[0] = 9`): an indexed left side of `=`
  is an assignment (`setitem` in `classify`), done on a deep copy that then replaces the variable,
  so earlier `$n` keep their values.
- **Python lines**: a line starting with a statement keyword (`def`, `for`, `import`, …) runs as
  Python directly; any other line that isn't calculator syntax falls back to Python. One line, with
  `;` between statements. They're plain Python: `^` is XOR and nothing is implied (Help says so).
- **Touch layout** (`keypad.js`, `touch.css`): an inline script in `index.html`'s `<head>` adds
  `class="touch"` to `<html>` before anything renders, on `(hover: none) and (pointer: coarse)`
  (phones, tablets without a mouse; an iPad with a trackpad gets the keyboard layout), or with
  `?layout=touch` / `?layout=desktop` (remembered in `localStorage` as `calc.layout`; `?layout=auto`
  forgets), and turns the browser's bars graphite. The page is a calculator meant to be buildable
  as it is: a screen, holding a status line (shift/alpha, messages with *stop* and *undo* links,
  what the soft keys show), the tape, the input and two rows of soft key labels on its bottom edge
  (in the keys' columns: F1–F5 do the lower row, shift F1–F5 or holding the key the upper one, as
  on the R47; a label can be tapped too), then 40 equal keys, five by eight:
  `F1–F5`, `shift alpha ▲ esc ⌫`, `trig ◀ ▼ ▶ menu`, `^ ( ) , ÷`, `ln 7 8 9 ×`, `π 4 5 6 −`,
  `= 1 2 3 +`, `x 0 . ans enter`. Each key prints its shift function (top left, `second`: √ [ ] :
  eˣ i (−) ≤≠ ∞ E ≈, abc on alpha, setup on esc, undo on ⌫, hyp on trig, catalog on menu, vars on
  x, pg/⇤/⇥ on the arrows) and its alpha letter (top right, `letter`): a–z run down five rows
  from trig, the arrows' row included, except x, whose own key types it (`ownLetter`); the soft
  keys never type letters, so completions show while typing in alpha. Shift and alpha apply to
  the next key (both: a capital), alpha twice locks letters, esc lets go of alpha first, and
  holding a key does its shift function. With a mouse, which the layout also gets on a computer
  (`?layout=touch`), shift-click is shift and option-click alpha (`clickMod`, the `mods`
  keyPressed takes). The soft keys show, first that applies: the view's own, the selected entry's
  actions (`selectionKeys`, from `selectionActions`), completions of the name being typed (2+
  letters; until a menu is asked for, `menuShown`), or the menu last opened (`touch.path`: the
  menu key goes up a level, and from the top back to where it was; a menu opened from another
  pushes onto it), ten to a page (`PAGE`), with a dot per page when there are more: shift ▲ ▼,
  the menu's key again, or a swipe turns the page. `▲ ▼` are the keyboard's ↑ ↓ (walk the tape);
  `◀ ▶` on a selected result flip it between exact, decimal and degrees (`cycleView`; on a
  graph they pan); shift enter evaluates to a decimal (app.js's `submitApprox`, also Shift+⏎ on a
  keyboard: the `pending` entry carries `approx`), or on an empty line flips the last result.
  **Views** (`VIEWS`): setup (`settings`), `vars`, `catalog` and help take the screen over,
  between the status line and the soft keys, as a TI-84's menus do, and are worked by keys alone,
  so they'd work on a device without a touch screen (`tests/keypad.mjs` checks): ▲ ▼ move (round
  from the end; shift: a page), ◀ ▶ change a setting or help's section, enter picks, esc (or the
  view's key again) goes back, and the soft keys do the rest (insert, forget, undo, help's
  sections). The catalog is a list (▲ ▼, its groups on the soft keys, enter inserts; alpha's
  letters jump to the first name that starts with them, in this group or else in all of it) and
  help pages (▶ from the list: the entry in full, its `see` entries on the soft keys and as links;
  ◀ or esc back the way it came, `view.pages`). Keys that would type into the line behind do
  nothing (`viewKey`); keys marked `anywhere` (menus, views, undo, F1–F5) work as ever. A keyboard
  (`?layout=touch` on a computer) types into the line as in the keyboard layout, and while a view
  shows works it as the keypad does (`onKeyboard`: arrows, ⏎, Esc, ⌫, Page Up/Down, letters,
  ⌃Z). Taps are extra: a tap selects a row, a tap on the selected row picks it (setup acts on the
  first). They are app.js's panels, shown differently: `setupTouch` puts `openView` into
  `panels`, so `:help`, `:vars`, `:catalog` and `?` open them (alpha's `?` is sent as a keydown,
  `typeLetter`, so an empty line's `?` is the catalog here too), and help reads the Help panel's
  sections (`#help section`, `data-tab` naming their soft keys). The look re-themes the screen's
  content by overriding the page's tokens (`--text`, `--muted`, …) on `.screen`. The keyboard
  layout must look and behave exactly as without it: touch styles live under `html.touch` only,
  and app.js only branches on `TOUCH` in `renderHints` (the status line and soft keys replace the
  hint line); graph.js fits graphs to the short tape on `TOUCH`. The keys reuse the keyboard's
  logic: a character key dispatches a synthetic `keydown` on the editor first and types only if
  app.js didn't `preventDefault` it, so `ans` continuation, `--`, ⏎ / ⌫ on a selection and ← → on
  a graph all apply unchanged; function keys go through `insertKey`, so they work in text and
  math input. The input has `inputmode="none"` (caret, no system keyboard); `abc` sets
  `inputmode="text"` and re-focuses inside the tap, which is what makes iOS raise its keyboard;
  when the editor loses focus, the keypad comes back. `main` follows `visualViewport`
  (`--app-height`, `--app-top`), since iOS covers the page with its keyboard instead of resizing
  it. Short screens (a phone on its side) put the keypad beside the screen, without legends. Key
  handling is pointer events on `#keypad` and the labels, acting on release; `touchstart` is
  `preventDefault`ed on keys (no double-tap zoom, no focus change). `iplot` graphs pan with one
  finger and pinch with two (`touchToMove` in graph.js, touch pointers only).
- **The hint line's actions** (a selection's Insert, Decimal, Copy…, Undo after a delete, Stop
  while computing) are buttons labelled with the key that does the same, so they teach the keys
  and work with a mouse. The touch layout shows the same actions on its soft keys: both come from
  `selectionActions()`, and flash messages ending in "· ⌃Z undo" (`UNDO_HINT`) get an Undo button
  (an *undo* link on the touch status line) and stay 5 s instead of 1.5.
- **Help** (`:help`, also a footer button) is static HTML in `index.html` (`#help`). It's the
  user's manual: keep it in step with the syntax, short and with examples. The touch layout
  shows it a section at a time, so keep it in `<section data-tab="…">`s, each with its `<h2>`;
  `touch-only` and `desktop-only` sections (and spans) show in one layout only.
- **Results** carry `latex`, `text` (single-line source, so picking a result can paste it back),
  optional `float` and `degrees` views, and a `label` for assignments. Objects that can't round-trip
  as text are inserted as `$n`.
- **Persistence** is IndexedDB (`calc` db, `kv` store: `tape`, `state`). The tape holds plot PNGs,
  which is why it isn't localStorage. Only names defined with calculator syntax (`a = …`,
  `f(x) = …`) are saved and shown by `:vars`.

## Conventions

- No build step, no framework, no npm dependencies: plain scripts loaded by `index.html`.
  Third-party code comes from jsDelivr with exact versions: Pyodide in `worker.js`, KaTeX in
  `index.html`, MathLive in `app.js`, uPlot in `graph.js`.
- **Keyboard first.** Every feature must work without the mouse; mouse controls (buttons)
  never take focus from the input (`mousedown` → `preventDefault`). Keep the number of shortcuts
  small: in the tape, single letters act on the selection (`f`, `d`, `c`); everything else types.
- **Touch second, never at the keyboard layout's expense.** A feature reachable by keyboard gets a
  touch path too, usually a key, a soft key or a settings entry calling the same function (or sending
  the same key, as `sendKey` does), reachable with the keys alone (taps are a shortcut, not the
  only way). Nothing in `touch.css` may match without `html.touch`.
- **Tips** (`setTip`): say what a control does, with an example when it helps. Don't repeat its
  label or the text it inserts (not "Factor: factor(…)").
- A new function for the keypad goes in `menus.json` (a soft menu), not in keypad.js. Keys in
  keypad.js are `{label (LaTeX with tex) or word, template, math}` (as in menus.json: in the
  template `|` marks the cursor or wraps the selection, in `math` `#0` does and `#?` is an empty
  MathLive box, `math: null` means text input only, `method: true` applies to `ans` on an empty
  line) or `type` (characters) or `action`, plus `second`, `letter`, `repeat`, `modifier`, `nav`
  (what the key is to a view) and `anywhere` (works while a view shows). Commands live in the
  `COMMANDS` table.
- `py/calc/` stays plain Python with no browser dependencies; test it natively. Anything Pyodide-
  specific belongs in `worker.js`.
- Every user-visible feature gets a line in the catalog (`catalog.py`) or the hint line, so it can
  be discovered, and syntax goes in the Help panel (`#help` in `index.html`).

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
Claude in Chrome. For the touch layout, emulate a phone (Playwright's `devices["iPhone 13"]`, which
matches `pointer: coarse`) or add `?layout=touch`; taps go through `page.touchscreen`, long presses
through CDP's `Input.dispatchTouchEvent`. Emulation has no system keyboard, so `abc` (and iOS's
keyboard covering the page) can only really be checked on a phone. The arrows are clip-path wedges
of one rocker: tap inside a wedge, not the middle of its box (`tests/keypad.mjs` has a `key(name)`
helper that does). The tape and variables live in that origin's IndexedDB, so testing on the same
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
| `1E3`, `6.02E23` | A power of ten (shift `ans` on the keypad). With no decimal point or negative exponent it stays exact: `1E3` is 1000, `6.02E23` a float (`exact_e_notation`) |
| `e`, `I`, `pi`, `oo` | Constants (`e` is `E`) |
| `M[1, 2]`, `M[[1, 2], [3, 4]]`, `V[1, 2]` | A matrix row, a matrix from rows, a column vector (`matrices.py`) |
| `A[0, 1] = 5`, `A[1, :] = M[7, 8]`, `v[0] = 9` | Change part of a defined value (shows the whole value; earlier `$n` keep theirs) |
| `[k^2 for k in range(5)]` | Comprehensions are calculator syntax too (`^` is power) |
| `:help`, `:catalog`, `:vars`, `:clear`, `:reset` | Help panel; the function catalog; Memory panel; empty the tape; also forget all variables |
| `def …`, `for …`, `import …`, anything else | Run as plain Python, one line (`;` between statements) |

Keys: <kbd>⏎</kbd> evaluate (on an empty line: repeat the last entry), <kbd>⇧⏎</kbd> evaluate to a decimal, <kbd>↑</kbd>/<kbd>↓</kbd>
select tape items (<kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> or Shift+click: a range), <kbd>⏎</kbd> insert
the selection, <kbd>f</kbd> exact/float, <kbd>d</kbd> degrees, <kbd>c</kbd> copy the cells as text
(`cellText`), <kbd>Shift</kbd>+<kbd>C</kbd> copy LaTeX, <kbd>⌫</kbd> delete the entries (one undo), <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo, <kbd>Tab</kbd>
complete, <kbd>?</kbd> catalog, <kbd>Ctrl</kbd>+<kbd>C</kbd> interrupt, <kbd>Ctrl</kbd>+<kbd>M</kbd> math input.
