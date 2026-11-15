// Calculator frontend: a tape of entries, one input line, a catalog popup.
//
// Focus never leaves the input (except for the catalog). "Browsing" the tape is
// just a selection: while something is selected, ↑/↓/⏎/f/c/Esc act on it and any
// other key drops the selection and types normally.
//
// The input line is either a text <input> or, after Ctrl+M, a MathLive math field
// (loaded on first use). The math field's LaTeX is turned back into calculator
// syntax by latex.js, so both modes send Python the same thing.

const tapeEl = document.getElementById("tape");
const emptyEl = document.getElementById("empty");
const input = document.getElementById("input");
const promptEl = document.getElementById("prompt");
const previewEl = document.getElementById("preview");
const hintsEl = document.getElementById("hint-text");
const catalogEl = document.getElementById("catalog");
const catalogSearch = document.getElementById("catalog-search");
const catalogList = document.getElementById("catalog-list");
const catalogDetail = document.getElementById("catalog-detail");

const LONG_TEXT = 80; // longer exact results are inserted as $n instead of their text
const CONTINUE_OPS = ["+", "-", "*", "/", "^"]; // typed first, these continue from ans
const MATHLIVE_URL = "https://cdn.jsdelivr.net/npm/mathlive@0.111.4/mathlive.min.js";
const KATEX_FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "coth", "exp", "log", "ln", "det", "gcd", "max", "min"]);

const state = {
  entries: [], // {id, input, outputs, result, error, pending, view: "exact" | "float"}
  catalog: [],
  names: { variables: [], functions: [], defined: [] },
  selected: null, // {id, part: "input" | "graph" | "result"}: where ↑ ↓ are, and what ⏎ f d act on
  anchor: null, // where a Shift+↑/↓ range started; c copies and ⌫ deletes the whole range
  ready: false, // Python loaded
  status: null, // what's loading or failing, shown in the hint line (startup has a bar)
  flash: null,
  mode: "text", // or "math"
};

let mathField = null; // the <math-field>, created on first switch to math mode

// --- rendering ---------------------------------------------------------------

function tex(el, latex, displayMode = true) {
  try {
    katex.render(latex, el, { displayMode, throwOnError: false, trust: false, strict: "ignore" });
  } catch {
    el.textContent = latex;
  }
}

function resultLatex(entry) {
  const r = entry.result;
  if (entry.view === "degrees" && r.degrees) return r.label ? `${r.label} = ${r.degrees.latex}` : r.degrees.latex;
  const isFloat = entry.view === "float" && r.float;
  const body = isFloat ? r.float.latex : r.latex;
  if (r.label) return `${r.label} ${isFloat ? "\\approx" : "="} ${body}`;
  return isFloat ? `\\approx ${body}` : body;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderOutputs(entry) {
  const wrap = el("div", "outputs");
  for (const out of entry.outputs) {
    if (out.kind === "text") wrap.append(el("pre", "", out.text.replace(/\n$/, "")));
    else if (out.kind === "latex") {
      const d = el("div", "latex");
      tex(d, out.latex);
      wrap.append(d);
    } else if (out.kind === "image") {
      const img = el("img");
      img.src = `data:image/png;base64,${out.png}`;
      if (out.width) img.style.width = `${out.width}px`; // retina figures are 2x their display size
      wrap.append(img);
    } else if (out.kind === "html") {
      const d = el("div", "html");
      d.innerHTML = out.html; // output of this tab's own Python
      wrap.append(d);
    } else if (out.kind === "graph") {
      wrap.append(renderGraph(entry.id, out, send)); // graph.js
    }
  }
  return wrap;
}

// Results are typeset inline (with \displaystyle, so they look the same) rather than
// in display mode: inline math can wrap at + and =, display math only overflows.
// Long digit runs (100!) get break points too.
function texWrapping(node, latex) {
  const breakable = latex.replace(/\d{30,}/g, (digits) => digits.match(/.{1,10}/g).join("\\allowbreak "));
  tex(node, `\\displaystyle ${breakable}`, false);
}

// Lists, tuples, sets and dicts come with their elements as separate pieces: one
// expression can't wrap at commas, but a row of pieces wraps like text
function renderItems(node, prefix, { open, close, items }) {
  node.classList.add("items");
  const last = items.length - 1;
  items.forEach((item, i) => {
    const piece = el("span", "piece");
    const head = i === 0 ? `${prefix ? `${prefix} ` : ""}${open}` : "";
    texWrapping(piece, `${head}${item}${i === last ? close : ","}`);
    node.append(piece);
  });
}

function renderResultMath(node, entry) {
  const r = entry.result;
  const isFloat = entry.view === "float" && r.float;
  const items = entry.view === "degrees" ? null : isFloat ? r.float.items : r.items;
  if (!items) {
    texWrapping(node, resultLatex(entry));
    return;
  }
  const relation = isFloat ? "\\approx" : "=";
  renderItems(node, r.label ? `${r.label} ${relation}` : isFloat ? relation : "", items);
}

function renderResult(entry) {
  const r = entry.result;
  const row = el("div", "item out");
  row.dataset.id = entry.id;
  row.dataset.part = "result";
  const math = el("div", "math");
  if (r.latex !== undefined) renderResultMath(math, entry);
  else if (r.png) {
    const img = el("img");
    img.src = `data:image/png;base64,${r.png}`;
    math.append(img);
  } else if (r.html) {
    const d = el("div", "html");
    d.innerHTML = r.html;
    math.append(d);
  } else math.append(el("pre", "", r.plain ?? ""));
  row.append(math);
  return row;
}

function renderEntry(entry) {
  const node = el("div", "entry" + (entry.pending ? " pending" : ""));
  node.dataset.id = entry.id;

  const inRow = el("div", "item in");
  inRow.dataset.id = entry.id;
  inRow.dataset.part = "input";
  inRow.append(setTip(el("span", "num", `$${entry.id}`), `Type $${entry.id} to use this result`));
  if (entry.input_latex) {
    // typeset, with the raw text shown when selected (it's what ⏎ inserts in text mode)
    const math = el("div", "math");
    tex(math, `\\displaystyle ${entry.input_latex}`, false);
    inRow.classList.add("typeset");
    inRow.append(math);
  }
  inRow.append(el("code", "src", entry.input));
  node.append(inRow);

  if (entry.pending) {
    const out = el("div", "out");
    out.append(el("div", "math"));
    node.append(out);
    return node;
  }
  if (entry.outputs?.length) node.append(renderOutputs(entry));
  if (entry.error) node.append(el("div", "err", entry.error));
  else if (entry.result) node.append(renderResult(entry));
  return node;
}

function renderTape() {
  destroyGraphs();
  tapeEl.querySelectorAll(".entry").forEach((n) => n.remove());
  for (const entry of state.entries) tapeEl.append(renderEntry(entry));
  emptyEl.hidden = state.entries.length > 0;
  renderSelection();
  scrollToBottomAfterImages(tapeEl);
}

function replaceEntryNode(entry) {
  const old = tapeEl.querySelector(`.entry[data-id="${entry.id}"]`);
  const node = renderEntry(entry);
  if (old) old.replaceWith(node);
  else tapeEl.append(node);
  emptyEl.hidden = true;
  renderSelection();
  return node;
}

function renderSelection() {
  tapeEl.querySelectorAll(".item.selected").forEach((n) => n.classList.remove("selected"));
  promptEl.classList.toggle("browsing", !!state.selected);
  const itemNode = (item) => tapeEl.querySelector(`.item[data-id="${item.id}"][data-part="${item.part}"]`);
  for (const item of selectedRange()) itemNode(item)?.classList.add("selected");
  if (state.selected) itemNode(state.selected)?.scrollIntoView({ block: "nearest" });
  renderHints();
}

function scrollToBottom() {
  tapeEl.scrollTop = tapeEl.scrollHeight;
}

// The tape shrinks when the preview below it appears (it takes no room while empty);
// if the tape was showing its end, keep it there, so the last result isn't covered
let tapeAtEnd = true;
tapeEl.addEventListener("scroll", () => {
  tapeAtEnd = tapeEl.scrollHeight - tapeEl.scrollTop - tapeEl.clientHeight < 4;
});
new ResizeObserver(() => tapeAtEnd && scrollToBottom()).observe(tapeEl);

// images (plots) and graphs get their height only once loaded or drawn, after we've
// already scrolled
function scrollToBottomAfterImages(node) {
  scrollToBottom();
  node.querySelectorAll("img").forEach((img) => {
    if (!img.complete) img.addEventListener("load", scrollToBottom, { once: true });
  });
  node.querySelectorAll(".graph").forEach((graph) => graph.addEventListener("drawn", scrollToBottom, { once: true }));
}

function busy() {
  return state.entries.some((e) => e.pending);
}

function renderHints() {
  if (TOUCH) return renderStrip(); // keypad.js: the strip above the keys says it instead
  const parts = [];
  if (state.status) parts.push(`<span class="status">${state.status}</span>`);
  else if (busy()) parts.push('<span class="status">computing…</span> <kbd>⌃C</kbd> interrupt');

  if (state.flash) parts.push(`<span class="flash">${state.flash}</span>`);
  else if (state.selected && selectedEntries().length > 1) {
    const n = selectedEntries().length;
    parts.push(`<kbd>c</kbd> copy ${n} cells`, `<kbd>⌫</kbd> delete ${n}`, "<kbd>⇧</kbd><kbd>↑</kbd><kbd>↓</kbd> more or fewer", "<kbd>Esc</kbd> back");
  } else if (state.selected?.part === "graph") {
    parts.push("<kbd>←</kbd><kbd>→</kbd> pan", "<kbd>+</kbd><kbd>−</kbd> zoom", "<kbd>0</kbd> reset", "<kbd>⏎</kbd> insert", "<kbd>c</kbd> copy", "<kbd>⌫</kbd> delete", "<kbd>Esc</kbd> back");
  } else if (state.selected) {
    const entry = entryById(state.selected.id);
    parts.push("<kbd>⏎</kbd> insert");
    if (state.selected.part === "result" && entry?.result?.float) parts.push("<kbd>f</kbd> exact/float");
    if (state.selected.part === "result" && entry?.result?.degrees) parts.push("<kbd>d</kbd> degrees");
    parts.push("<kbd>c</kbd> copy", "<kbd>⇧C</kbd> LaTeX", "<kbd>⇧</kbd><kbd>↑</kbd> more", "<kbd>⌫</kbd> delete", "<kbd>Esc</kbd> back");
  } else if (state.mode === "math") {
    parts.push("<kbd>⏎</kbd> evaluate", "<kbd>↑</kbd> history", "<kbd>→</kbd> leave a box", "<kbd>?</kbd> catalog", "<kbd>⌃M</kbd> text input");
  } else {
    parts.push("<kbd>⏎</kbd> evaluate", "<kbd>↑</kbd> history", "<kbd>Tab</kbd> complete", "<kbd>?</kbd> catalog", "<kbd>⌃M</kbd> math input");
  }
  hintsEl.innerHTML = parts.join(" · ");
}

function flash(message) {
  state.flash = message;
  renderHints();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    state.flash = null;
    renderHints();
  }, TOUCH && message.includes("⌃Z") ? 5000 : 1500); // on a touch screen, time to tap Undo
}

// --- hover tips ------------------------------------------------------------------
//
// Quicker and better-looking than title="": one floating element, shown above
// whatever [data-tip] the mouse rests on.

const tipEl = el("div", "tip");
tipEl.hidden = true;
tipEl.setAttribute("role", "tooltip");
document.body.append(tipEl);
let tipTimer = null;

function setTip(node, text) {
  node.dataset.tip = text;
  node.setAttribute("aria-label", text);
  return node;
}

function showTip(target) {
  tipEl.textContent = target.dataset.tip;
  tipEl.hidden = false;
  const r = target.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const left = Math.min(Math.max(4, r.left + r.width / 2 - w / 2), window.innerWidth - w - 4);
  const top = r.top - h - 6 >= 4 ? r.top - h - 6 : r.bottom + 6;
  tipEl.style.left = `${left}px`;
  tipEl.style.top = `${top}px`;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipEl.hidden = true;
}

document.addEventListener("mouseover", (e) => {
  const target = e.target.closest?.("[data-tip]");
  if (!target) return hideTip();
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(target), tipEl.hidden ? 300 : 0);
});
document.addEventListener("mousedown", hideTip, true);
document.addEventListener("keydown", hideTip, true);

// --- tape selection ----------------------------------------------------------

function entryById(id) {
  return state.entries.find((e) => e.id === id);
}

function selectableItems() {
  const items = [];
  for (const e of state.entries) {
    if (e.pending) continue;
    items.push({ id: e.id, part: "input" });
    if (e.outputs?.some((out) => out.kind === "graph")) items.push({ id: e.id, part: "graph" });
    if (e.result) items.push({ id: e.id, part: "result" });
  }
  return items;
}

function selectedIndex(items) {
  if (!state.selected) return -1;
  return items.findIndex((i) => i.id === state.selected.id && i.part === state.selected.part);
}

function select(item) {
  state.selected = item;
  state.anchor = null;
  renderSelection();
}

// The items from the anchor to the selection (just the selection without a range)
function selectedRange() {
  if (!state.selected) return [];
  const items = selectableItems();
  const at = selectedIndex(items);
  const from = state.anchor ? items.findIndex((i) => i.id === state.anchor.id && i.part === state.anchor.part) : -1;
  if (at === -1 || from === -1) return [state.selected];
  return items.slice(Math.min(from, at), Math.max(from, at) + 1);
}

// The entries the selection touches, in tape order
function selectedEntries() {
  const ids = [...new Set(selectedRange().map((item) => item.id))];
  return ids.map(entryById).filter(Boolean);
}

// Shift+↑/↓: grow or shrink a range from where it started
function extendSelection(delta) {
  const items = selectableItems();
  const at = selectedIndex(items);
  if (at === -1) return;
  const anchor = state.anchor ?? state.selected;
  state.selected = items[Math.min(items.length - 1, Math.max(0, at + delta))];
  state.anchor = anchor;
  renderSelection();
}

function moveSelection(delta) {
  const items = selectableItems();
  if (!items.length) return;
  let index = selectedIndex(items);
  index = index === -1 ? items.length - 1 : index + delta;
  if (index >= items.length) select(null);
  else select(items[Math.max(0, index)]);
}

function textFor(item) {
  const entry = entryById(item.id);
  if (item.part === "input" || item.part === "graph") return entry.input;
  const r = entry.result;
  if (entry.view === "float" && r.float) return r.float.text;
  if (entry.view === "degrees" && r.degrees) return r.degrees.text;
  return r.text.length > LONG_TEXT ? `$${entry.id}` : r.text;
}

// LaTeX of a result as currently shown (exact, float or degrees)
function viewLatex(entry) {
  const r = entry.result;
  if (entry.view === "float" && r.float) return r.float.latex;
  if (entry.view === "degrees" && r.degrees) return r.degrees.latex;
  return r.latex;
}

function latexFor(item) {
  const entry = entryById(item.id);
  if (item.part === "input" || item.part === "graph") return entry.input_latex;
  const r = entry.result;
  if (r.latex === undefined) return `\\boxed{${entry.id}}`;
  return entry.view === "exact" || !entry.view ? (r.text.length > LONG_TEXT ? `\\boxed{${entry.id}}` : r.latex) : viewLatex(entry);
}

function insertSelected() {
  if (state.mode === "math") {
    const latex = latexFor(state.selected);
    if (!latex) {
      flash("This one can only be inserted in text mode (⌃M)");
      return;
    }
    const isAtom = /^(\\boxed\{\d+\}|[\w.]+)$/.test(latex);
    insertMath(mathField.value && !isAtom ? `\\left(${latex}\\right)` : latex);
  } else {
    const text = textFor(state.selected);
    const isAtom = /^[\w.$]+$/.test(text);
    insertAtCursor(input.value.trim() && !isAtom ? `(${text})` : text);
  }
  select(null);
}

// Removes the selected entries (input and result) from the tape, all of a range at once
// (one ⌃Z brings them back). Their values stay reachable as $n; the selection moves to
// the item that takes their place.
function deleteSelected() {
  const ids = selectedEntries().map((e) => e.id);
  const items = selectableItems();
  const before = items.findIndex((item) => ids.includes(item.id));
  state.entries = state.entries.filter((e) => !ids.includes(e.id));
  for (const id of ids) tapeEl.querySelector(`.entry[data-id="${id}"]`)?.remove();
  emptyEl.hidden = state.entries.length > 0;
  send({ type: "delete", ids });
  const remaining = selectableItems();
  select(remaining.length ? remaining[Math.min(before, remaining.length - 1)] : null);
  flash(`Deleted ${ids.length > 1 ? `${ids.length} entries` : `entry ${ids[0]}`} · <kbd>⌃Z</kbd> undo`);
}

function toggleView(view) {
  const entry = entryById(state.selected.id);
  if (state.selected.part !== "result" || !entry.result?.[view]) return;
  entry.view = entry.view === view ? "exact" : view;
  replaceEntryNode(entry);
}

// A tape cell as plain text: the input, any printed output, and "= result" (≈ for the
// float view) unless that only repeats what was typed (a = 3/7, f(x) = x^2, x^2 = 4)
function cellText(entry) {
  const lines = [entry.input];
  for (const out of entry.outputs ?? []) if (out.kind === "text") lines.push(out.text.replace(/\n$/, ""));
  const r = entry.result;
  if (entry.error) lines.push(entry.error);
  else if (r) {
    const view = entry.view === "float" ? r.float : entry.view === "degrees" ? r.degrees : null;
    const text = view?.text ?? (r.latex === undefined ? r.plain ?? r.text : r.text);
    const squash = (s) => s.replace(/\s+/g, "").replaceAll("**", "^");
    const assigned = r.label ? entry.input.replace(/^[^=]*?:?=(?!=)/, "") : entry.input;
    const defined = r.label && /^\s*\w+\s*\(/.test(entry.input) && /^\w+$/.test(r.text) && !view;
    const equation = !r.label && !view && r.text.startsWith("Eq(") && /[^=<>!:]=[^=]/.test(entry.input);
    if (!defined && !equation && squash(text) !== squash(assigned)) lines.push(`${entry.view === "float" ? "≈" : "="} ${text}`);
  }
  return lines.join("\n");
}

async function writeClipboard(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    flash(`Copied ${what}`);
  } catch {
    flash("Couldn't copy to the clipboard");
  }
}

// c: the selected cells (a whole range), as plain text
function copySelected() {
  const entries = selectedEntries();
  writeClipboard(entries.map(cellText).join("\n\n"), entries.length > 1 ? `${entries.length} cells` : "the cell");
}

// Shift+C: the selected item's LaTeX, for papers and notes with math
function copyLatex() {
  const entry = entryById(state.selected.id);
  const latex = state.selected.part === "result" && entry.result.latex !== undefined ? viewLatex(entry) : entry.input_latex;
  if (latex) writeClipboard(latex, "LaTeX");
  else flash("This one has no LaTeX: c copies it as text");
}

// --- input -------------------------------------------------------------------

function insertAtCursor(text, replaceFrom = null) {
  const start = replaceFrom ?? input.selectionStart;
  const end = input.selectionEnd;
  input.setRangeText(text, start, end, "end");
  // name( -> name(|) with the cursor inside the parens
  if (text.endsWith("(")) {
    input.setRangeText(")", input.selectionStart, input.selectionStart, "start");
  }
  input.focus();
  schedulePreview();
}

// --- symbol palette ----------------------------------------------------------
//
// Templates mark the cursor with "|"; selected text in the input lands there, so
// selecting x+1 and clicking √ gives sqrt(x+1). Clicking never moves focus away
// from the input.

const PALETTE = [
  // [label, text template, math template, hover tip: what it does, not its name again]: "|" / #0 is the cursor (or the selection), #? an empty box
  [
    ["\\sqrt{x}", "sqrt(|)", "\\sqrt{#0}", "√8 = 2√2, kept exact"],
    ["\\sqrt[n]{x}", "root(|, 3)", "\\sqrt[#?]{#0}", "Root of any degree: the cube root of 27 is 3"],
    ["x^2", "^2", "^2", "Squares what's before the cursor (on an empty line, the last result)"],
    ["x^n", "^(|)", "^{#0}", "Raise to any power, like 2¹⁰ or x^(1/3)"],
    ["\\frac{a}{b}", "(|)/()", "\\frac{#0}{#?}", "Results stay exact: 1/3 + 1/6 = 1/2"],
    ["|x|", "abs(|)", "\\left|#0\\right|", "Distance from zero: |−3| = 3"],
    ["n!", "!", "!", "5! = 5·4·3·2·1 = 120"],
    ["\\tbinom{n}{k}", "binomial(|, )", "\\binom{#0}{#?}", "Ways to choose k of n items: 5 choose 2 = 10"],
  ],
  [
    ["\\pi", "pi", "\\pi", "Exact π; press f on a result for its decimal value"],
    ["e", "e", "e", "e ≈ 2.71828, the base of the natural log"],
    ["i", "I", "i", "i² = −1, for complex numbers"],
    ["\\infty", "oo", "\\infty", "For limits, sums and integrals that go on forever"],
    ["x^\\circ", "°", "\\degree", "Angles are radians unless marked: sin(30°) = 1/2"],
  ],
  [
    ["\\sin", "sin(|)", "\\sin\\left(#0\\right)", "Angle in radians; add ° for degrees"],
    ["\\cos", "cos(|)", "\\cos\\left(#0\\right)", "Angle in radians; add ° for degrees"],
    ["\\tan", "tan(|)", "\\tan\\left(#0\\right)", "Angle in radians; add ° for degrees"],
    ["\\ln", "log(|)", "\\ln\\left(#0\\right)", "Logarithm base e"],
    ["\\log_b", "log(|, 10)", "\\log_{#?}\\left(#0\\right)", "Any base: log₂ 8 = 3"],
    ["e^x", "exp(|)", "e^{#0}", "e raised to a power"],
  ],
  [
    ["\\frac{d}{dx}", "diff(|, x)", "\\frac{d}{dx}\\left(#0\\right)", "Rate of change with respect to x"],
    ["\\int", "integrate(|, x)", "\\int #0\\,dx", "Antiderivative with respect to x"],
    ["\\int_a^b", "integrate(|, (x, 0, 1))", "\\int_{#?}^{#?} #0\\,dx", "Area under the curve from a to b"],
    ["\\lim", "limit(|, x, 0)", "\\lim_{x\\to #?} #0", "What the expression approaches as x → a"],
    ["\\sum", "summation(|, (k, 1, n))", "\\sum_{k=#?}^{#?} #0", "Add up terms for k from a to b; b can be ∞"],
  ],
  [
    ["\\begin{bmatrix}\\cdot\\end{bmatrix}", "Matrix([[|]])", "\\begin{bmatrix}#0 & #?\\\\ #? & #?\\end{bmatrix}", "2×2 to start; Tab moves between cells (math input)"],
    ["\\text{solve}", "solve(|, x)", "\\operatorname{solve}\\left(#0, x\\right)", "Values of x that make it zero, or that satisfy an equation"],
    ["\\text{simplify}", "simplify(|)", "\\operatorname{simplify}\\left(#0\\right)", "Rewrite in the simplest form SymPy can find"],
    ["\\text{factor}", "factor(|)", "\\operatorname{factor}\\left(#0\\right)", "As a product: x² − 1 → (x − 1)(x + 1)"],
    ["\\text{expand}", "expand(|)", "\\operatorname{expand}\\left(#0\\right)", "Multiply out: (x + 1)² → x² + 2x + 1"],
    ["\\text{plot}", "plot(|, (x, -5, 5))", "\\operatorname{plot}\\left(#0, \\left(x, -5, 5\\right)\\right)", "Graph it for x from −5 to 5 (edit the range after inserting)"],
  ],
];

function insertTemplate(template, mathTemplate) {
  if (state.mode === "math") {
    if (!mathField.value && /^[\^!]/.test(mathTemplate)) {
      mathTemplate = `\\mathrm{ans}${mathTemplate}`;
    }
    insertMath(mathTemplate);
    return;
  }
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const selected = input.value.slice(start, end);
  let [before, after = ""] = template.split("|");
  // like typing an operator first: on an empty line, x² means ans^2
  if (!input.value && /^[\^!]/.test(before)) before = `ans${before}`;
  input.setRangeText(before + selected + after, start, end, "end");
  const cursor = start + before.length + selected.length;
  input.setSelectionRange(cursor, cursor);
  input.focus();
  schedulePreview();
}

// --- commands (:vars, :clear, :reset) -----------------------------------------

const COMMANDS = {
  help: { help: "how to type things: syntax, vectors and matrices, Python, keys", run: () => openHelp() },
  vars: { help: "show everything you've defined, with its value", run: () => openMemory() },
  clear: { help: "empty the tape; variables are kept (⌃Z brings it back)", run: clearTape },
  reset: { help: "empty the tape and forget all variables", run: () => send({ type: "reset" }) },
};

function clearTape() {
  const had = state.entries.length > 0;
  if (!send({ type: "clear" })) return false;
  if (had) flash(`Cleared the tape · <kbd>⌃Z</kbd> undo`);
  return true;
}

// Ctrl+Z takes back the last delete, forget or :clear (the backend keeps them)
function undo() {
  select(null);
  send({ type: "undo" });
}

// Ctrl+Z is ours where it can't be the editor's own undo: with nothing typed (or a tape
// item selected); with text, it undoes typing (Windows, Linux; on a Mac that's ⌘Z)
function isUndoKey(e, empty) {
  return e.key === "z" && e.ctrlKey && !e.metaKey && !e.altKey && (empty || state.selected);
}

// Reset from a button asks for a second click; typing :reset is deliberate enough
let resetArmedUntil = 0;

function commandButton(name) {
  const command = COMMANDS[name];
  const b = el("button", "command", `:${name}`);
  b.type = "button";
  b.tabIndex = -1;
  const tip = command.help[0].toUpperCase() + command.help.slice(1);
  setTip(b, name === "reset" ? `${tip} (asks you to click twice)` : tip);
  b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the input focused
  b.addEventListener("click", () => {
    select(null);
    if (name === "reset" && Date.now() > resetArmedUntil) {
      resetArmedUntil = Date.now() + 4000;
      flash("Click :reset again to forget all variables and clear the tape");
      return;
    }
    resetArmedUntil = 0;
    if (!command.run()) flash("Python is still loading");
  });
  return b;
}

function renderPalette() {
  const palette = document.getElementById("palette");
  for (const group of PALETTE) {
    const g = el("div", "group");
    for (const [label, template, mathTemplate, tip] of group) {
      const b = el("button");
      b.type = "button";
      b.tabIndex = -1;
      setTip(b, tip);
      tex(b, label, false);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the input focused
      b.addEventListener("click", () => {
        select(null);
        insertTemplate(template, mathTemplate);
      });
      g.append(b);
    }
    palette.append(g);
  }
}

function renderCommands() {
  const commands = document.getElementById("commands");
  for (const name of Object.keys(COMMANDS)) commands.append(commandButton(name));
}

// The revision this page was deployed from (the deploy's ?v= stamp, see backend.js),
// linking to that commit; running locally there's no stamp and it says "local"
function renderAbout() {
  const sha = new URLSearchParams(VERSION).get("v");
  const revision = document.getElementById("revision");
  if (sha) {
    revision.textContent = sha.slice(0, 7);
    revision.href = `https://github.com/jmelis/calc/commit/${sha}`;
    setTip(revision, "The version you're running: what changed in it, on GitHub");
  }
  const links = document.querySelectorAll("#about a");
  links.forEach((a) => a.addEventListener("mousedown", (e) => e.preventDefault())); // keep the input focused
  setTip(links[1], "This calculator's code, on GitHub");
}

function wordBeforeCursor() {
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/[A-Za-z_]\w*$/);
  return m ? { prefix: m[0], start: input.selectionStart - m[0].length } : { prefix: "", start: input.selectionStart };
}

function complete() {
  const { prefix, start } = wordBeforeCursor();
  if (prefix) {
    const functions = new Set([...state.names.functions, ...state.catalog.filter((c) => c.insert.endsWith("(")).map((c) => c.name)]);
    const candidates = [...new Set([
      ...state.catalog.filter((c) => /^\w+$/.test(c.name)).map((c) => c.name),
      ...state.names.functions,
      ...state.names.variables,
    ])].filter((n) => n.startsWith(prefix));
    if (candidates.length === 1) {
      const name = candidates[0];
      insertAtCursor(functions.has(name) ? `${name}(` : name, start);
      return;
    }
  }
  openCatalog(prefix, prefix ? start : null);
}

function editorSource() {
  if (state.mode === "text") return input.value.trim();
  return latexToCalc(mathField.value).trim(); // throws LatexError for incomplete input
}

function clearEditor() {
  input.value = "";
  if (mathField) mathField.value = "";
  clearPreview();
}

function submit() {
  let src;
  try {
    src = editorSource();
  } catch (e) {
    flash(e.message);
    return;
  }
  // ⏎ on an empty line repeats the last entry, like a calculator (ans*2, ⏎, ⏎, ...)
  if (!src) src = state.entries.findLast((e) => !e.pending)?.input ?? "";
  if (!src) return;
  // pasted or typed fast: an operator first still continues from ans
  if (/^[+*/^]/.test(src)) src = `ans${src}`;
  let sent;
  if (src.startsWith(":")) {
    const command = COMMANDS[src.slice(1).trim()];
    if (!command) {
      flash(`Unknown command ${src} (try ${Object.keys(COMMANDS).map((c) => `:${c}`).join(", ")})`);
      return;
    }
    sent = command.run();
  } else sent = send({ type: "eval", src });
  if (!sent) {
    flash("Python is still loading, so nothing was sent");
    return; // keep what was typed
  }
  clearEditor();
}

input.addEventListener("keydown", (e) => {
  if (e.key === "c" && e.ctrlKey && busy() && input.selectionStart === input.selectionEnd) {
    e.preventDefault();
    send({ type: "interrupt" });
    return;
  }
  if (e.key === "m" && e.ctrlKey) {
    e.preventDefault();
    toggleMode();
    return;
  }
  if (isUndoKey(e, input.value === "")) {
    e.preventDefault();
    undo();
    return;
  }
  if (state.selected) return browseKey(e);

  if (e.key === "ArrowUp") {
    e.preventDefault();
    moveSelection(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    submit();
  } else if (e.key === "Escape") {
    input.value = "";
    clearPreview();
  } else if (e.key === "Tab") {
    e.preventDefault();
    complete();
  } else if (e.key === "?" && input.value === "") {
    e.preventDefault();
    openCatalog("");
  } else if (e.key === "-" && input.value === "ans-" && input.selectionStart === 4) {
    // a second "-" means a negative number, not "ans minus": --5 types -5
    e.preventDefault();
    input.value = "-";
    schedulePreview();
  } else if (CONTINUE_OPS.includes(e.key) && input.value === "") {
    e.preventDefault();
    insertAtCursor(`ans${e.key}`);
  }
});

function browseKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.selected.part === "graph" && graphKey(state.selected.id, e.key)) { // graph.js
    e.preventDefault();
    return;
  }
  const handled = {
    ArrowUp: () => (e.shiftKey ? extendSelection(-1) : moveSelection(-1)),
    ArrowDown: () => (e.shiftKey ? extendSelection(1) : moveSelection(1)),
    Enter: insertSelected,
    Escape: () => select(null),
    f: () => toggleView("float"),
    d: () => toggleView("degrees"),
    c: copySelected,
    C: copyLatex,
    Backspace: deleteSelected,
    Delete: deleteSelected,
  }[e.key];
  if (handled) {
    e.preventDefault();
    handled();
  } else {
    // anything else goes back to typing (and still reaches the input)
    select(null);
  }
}

input.addEventListener("input", schedulePreview);

// --- live preview ----------------------------------------------------------

let previewSeq = 0;
let previewTimer = null;

// The preview's room opens with a line's first keystroke and stays until the line is
// done (⏎, Esc), so the composer doesn't jump while typing; an unfinished line (1/100+)
// keeps the last preview, dimmed, instead of blanking it
function clearPreview() {
  previewSeq++; // a reply still on its way is stale
  previewEl.innerHTML = "";
  previewEl.classList.remove("open", "stale");
}

function schedulePreview() {
  clearTimeout(previewTimer);
  cancelAnimationFrame(previewTimer);
  if (state.mode === "math") {
    // the math field is already pretty; show what will be sent instead. A frame
    // later, since MathLive can fire "input" before its value has the last keystroke
    previewTimer = requestAnimationFrame(() => {
      previewEl.innerHTML = "";
      previewEl.classList.toggle("open", !!mathField.value);
      if (!mathField.value) return;
      try {
        previewEl.append(el("code", "converted", latexToCalc(mathField.value)));
      } catch (e) {
        previewEl.append(el("span", "converted pending-input", e.message));
      }
    });
    return;
  }
  previewTimer = setTimeout(() => {
    const src = input.value.trim();
    if (!src) return clearPreview();
    previewEl.classList.add("open");
    if (src.startsWith(":") || previewEl.querySelector(".command-hint")) {
      previewEl.innerHTML = "";
      previewEl.classList.remove("stale");
    }
    if (src.startsWith(":")) {
      const typed = src.slice(1);
      for (const [name, command] of Object.entries(COMMANDS)) {
        if (!name.startsWith(typed)) continue;
        const row = el("div", "command-hint");
        row.append(el("code", "", `:${name}`), el("span", "", command.help));
        previewEl.append(row);
      }
      return;
    }
    send({ type: "preview", target: "input", seq: ++previewSeq, src });
  }, 90);
}

function onPreview(msg) {
  if (msg.target === "convert") {
    conversions.get(msg.seq)?.(msg.latex);
    conversions.delete(msg.seq);
  } else if (msg.target === "input") {
    if (msg.seq !== previewSeq) return;
    if (msg.latex) {
      tex(previewEl, msg.latex);
      previewEl.classList.remove("stale");
    } else previewEl.classList.add("stale"); // unfinished: keep the last one, dimmed
  } else if (msg.target === "catalog") {
    const target = catalogDetail.querySelector(".example-math");
    if (target && msg.seq === catalogState.exampleSeq && msg.latex) tex(target, msg.latex);
  }
}

// --- catalog -----------------------------------------------------------------

const catalogState = { items: [], index: 0, replaceFrom: null, exampleSeq: 0 };

function catalogEntries() {
  const defined = state.names.defined.map((name) => ({
    name,
    signature: "",
    summary: "Defined in this session",
    example: "",
    category: "Your definitions",
    source: "you",
    doc: "",
    insert: state.names.functions.includes(name) ? `${name}(` : name,
  }));
  return [...defined, ...state.catalog];
}

function score(entry, q) {
  if (!q) return 1;
  const name = entry.name.toLowerCase();
  if (name === q) return 100;
  if (name.startsWith(q)) return 50 - name.length / 100;
  if (name.includes(q)) return 30 - name.length / 100;
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  if (i === q.length) return 10 - name.length / 100;
  if (entry.summary.toLowerCase().includes(q)) return 5;
  return 0;
}

function openCatalog(query, replaceFrom = null) {
  catalogState.replaceFrom = replaceFrom;
  catalogEl.hidden = false;
  catalogSearch.value = query;
  catalogSearch.focus();
  filterCatalog();
}

function hideCatalog() {
  // blur first: hiding the focused search box makes Chrome drop focus to <body> later
  catalogSearch.blur();
  catalogEl.hidden = true;
}

function closeCatalog() {
  hideCatalog();
  requestAnimationFrame(focusEditor);
}

function filterCatalog() {
  const q = catalogSearch.value.trim().toLowerCase();
  const all = catalogEntries();
  catalogState.items = q
    ? all.map((e) => [score(e, q), e]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).map(([, e]) => e)
    : all;
  catalogState.index = 0;
  renderCatalog(!q);
}

function renderCatalog(grouped) {
  catalogList.innerHTML = "";
  let category = null;
  catalogState.items.forEach((entry, i) => {
    if (grouped && entry.category !== category) {
      category = entry.category;
      catalogList.append(el("li", "category", category));
    }
    const li = el("li", "fn" + (i === catalogState.index ? " active" : ""));
    li.dataset.index = i;
    li.append(el("span", "", entry.name), el("span", "src", grouped ? "" : entry.category));
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      catalogState.index = i;
      updateCatalogActive();
    });
    li.addEventListener("dblclick", insertFromCatalog);
    catalogList.append(li);
  });
  renderCatalogDetail();
}

function updateCatalogActive() {
  catalogList.querySelectorAll(".fn").forEach((li) => {
    const active = Number(li.dataset.index) === catalogState.index;
    li.classList.toggle("active", active);
    if (active) li.scrollIntoView({ block: "nearest" });
  });
  renderCatalogDetail();
}

function renderCatalogDetail() {
  const entry = catalogState.items[catalogState.index];
  catalogDetail.innerHTML = "";
  if (!entry) {
    catalogDetail.append(el("p", "summary", "Nothing matches."));
    return;
  }
  catalogDetail.append(el("h2", "", entry.name));
  if (entry.signature) catalogDetail.append(el("div", "sig", entry.signature));
  if (entry.summary) catalogDetail.append(el("p", "summary", entry.summary));
  if (entry.example) {
    const ex = el("div", "example");
    ex.append(el("code", "", entry.example));
    catalogDetail.append(ex, el("div", "example-math"));
    if (!entry.example.startsWith(":")) {
      send({ type: "preview", target: "catalog", seq: ++catalogState.exampleSeq, src: entry.example });
    }
  }
  if (entry.doc && entry.doc !== entry.summary) catalogDetail.append(el("pre", "", entry.doc));
}

function catalogMath(entry) {
  const name = entry.name;
  const fn = name === "log" ? "\\ln" : KATEX_FUNCS.has(name) ? `\\${name}` : `\\operatorname{${name}}`;
  if (entry.insert.endsWith("(") && /^\w+\($/.test(entry.insert)) return `${fn}\\left(#0\\right)`;
  if (/^\w+$/.test(entry.insert)) return name.length > 1 ? `\\mathrm{${name}}` : name;
  return null; // methods (.subs), commands (:clear), syntax notes
}

function insertFromCatalog() {
  const entry = catalogState.items[catalogState.index];
  if (!entry) return;
  hideCatalog();
  if (state.mode === "math") {
    const special = { pi: "\\pi", oo: "\\infty", E: "e", I: "i" }[entry.name];
    const latex = special ?? catalogMath(entry);
    // after the catalog's search box is hidden, or focus falls back to <body>
    requestAnimationFrame(() => {
      focusEditor();
      if (latex) insertMath(latex);
      else flash(`${entry.name}: switch to text input (⌃M) for this one`);
    });
    return;
  }
  input.focus();
  if (catalogState.replaceFrom !== null) input.setSelectionRange(input.selectionStart, input.selectionStart);
  insertAtCursor(entry.insert, catalogState.replaceFrom);
}

catalogSearch.addEventListener("input", filterCatalog);
catalogSearch.addEventListener("keydown", (e) => {
  const n = catalogState.items.length;
  if (e.key === "ArrowDown" && n) {
    e.preventDefault();
    catalogState.index = (catalogState.index + 1) % n;
    updateCatalogActive();
  } else if (e.key === "ArrowUp" && n) {
    e.preventDefault();
    catalogState.index = (catalogState.index - 1 + n) % n;
    updateCatalogActive();
  } else if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    insertFromCatalog();
  } else if (e.key === "Escape") {
    e.preventDefault();
    closeCatalog();
  }
});
catalogEl.addEventListener("mousedown", (e) => {
  if (e.target === catalogEl) {
    e.preventDefault();
    closeCatalog();
  }
});

// --- memory: what's defined, with values (:vars) -------------------------------

const memoryEl = document.getElementById("memory");
const memoryPanel = memoryEl.querySelector(".panel");
const memoryList = document.getElementById("memory-list");
const memoryState = { items: [], index: 0 };

function openMemory() {
  if (!send({ type: "vars" })) return false;
  memoryState.items = [];
  memoryList.innerHTML = "";
  memoryList.append(el("li", "empty", "Loading…"));
  memoryEl.hidden = false;
  memoryPanel.focus();
  return true;
}

function closeMemory() {
  memoryPanel.blur(); // see hideCatalog
  memoryEl.hidden = true;
  requestAnimationFrame(focusEditor);
}

function onVariables(msg) {
  if (memoryEl.hidden) return;
  memoryState.items = msg.items;
  memoryState.index = Math.min(memoryState.index, Math.max(0, msg.items.length - 1));
  renderMemory();
  if (msg.error) flash(msg.error);
}

function renderMemory() {
  memoryList.innerHTML = "";
  if (memoryState.items.length <= 1) {
    memoryList.append(el("li", "empty", "Nothing defined yet: a = 3/7 or f(x) = x^2 + 1 define things."));
  }
  memoryState.items.forEach((item, i) => {
    const li = el("li", "var" + (i === memoryState.index ? " active" : ""));
    const math = el("div", "math");
    tex(math, item.latex, false);
    li.append(math, el("span", "kind", item.kind));
    li.addEventListener("mousedown", (e) => {
      e.preventDefault();
      memoryState.index = i;
      renderMemory();
    });
    li.addEventListener("dblclick", insertFromMemory);
    memoryList.append(li);
    if (i === memoryState.index) requestAnimationFrame(() => li.scrollIntoView({ block: "nearest" }));
  });
}

function insertFromMemory() {
  const item = memoryState.items[memoryState.index];
  if (!item) return;
  closeMemory();
  const fn = item.kind === "function";
  requestAnimationFrame(() => {
    if (state.mode === "math") {
      const name = item.name.length > 1 ? `\\mathrm{${item.name}}` : item.name;
      insertMath(fn ? `${name}\\left(#?\\right)` : name);
    } else insertAtCursor(fn ? `${item.name}(` : item.name);
  });
}

memoryPanel.addEventListener("keydown", (e) => {
  const n = memoryState.items.length;
  const item = memoryState.items[memoryState.index];
  if (e.key === "ArrowDown" && n) memoryState.index = (memoryState.index + 1) % n;
  else if (e.key === "ArrowUp" && n) memoryState.index = (memoryState.index - 1 + n) % n;
  else if (e.key === "Enter") return void (e.preventDefault(), insertFromMemory());
  else if (e.key === "Escape") return void (e.preventDefault(), closeMemory());
  else if ((e.key === "Backspace" || e.key === "Delete") && item && item.name !== "ans") {
    send({ type: "forget", name: item.name });
    flash(`Forgot ${item.name} · <kbd>⌃Z</kbd> undo`);
  } else if (e.key === "z" && e.ctrlKey) send({ type: "undo" }); // the list refreshes when it's back
  else return;
  e.preventDefault();
  renderMemory();
});
memoryEl.addEventListener("mousedown", (e) => {
  if (e.target === memoryEl) {
    e.preventDefault();
    closeMemory();
  }
});

// --- help (:help) ----------------------------------------------------------------

const helpEl = document.getElementById("help");
const helpPanel = helpEl.querySelector(".panel");
const helpBody = helpEl.querySelector(".body");

function openHelp() {
  helpEl.hidden = false;
  helpBody.scrollTop = 0;
  helpBody.focus(); // the focused scroller is what ↑ ↓ PageUp PageDown scroll
  return true;
}

function closeHelp() {
  helpBody.blur(); // see hideCatalog
  helpEl.hidden = true;
  requestAnimationFrame(focusEditor);
}

helpPanel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closeHelp();
  }
});
helpEl.addEventListener("mousedown", (e) => {
  if (e.target === helpEl) {
    e.preventDefault();
    closeHelp();
  }
});

// --- mouse: optional, but clicks shouldn't strand the focus ------------------

tapeEl.addEventListener("click", (e) => {
  const item = e.target.closest(".item[data-part]");
  if (item && !item.closest(".pending")) {
    const clicked = { id: Number(item.dataset.id), part: item.dataset.part };
    if (e.shiftKey && state.selected) {
      // Shift+click: a range from where the selection was, as Shift+↑/↓ makes
      state.anchor ??= state.selected;
      state.selected = clicked;
      renderSelection();
    } else select(clicked);
  }
  if (!window.getSelection().toString()) focusEditor();
});
tapeEl.addEventListener("dblclick", (e) => {
  if (e.target.closest(".item[data-part]") && state.selected) insertSelected();
});
// copying typeset math with the mouse would give KaTeX's rendered text (with hidden
// duplicates); within one tape row, copy what you'd type instead
document.addEventListener("copy", (e) => {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const item = (node) => (node?.nodeType === 1 ? node : node?.parentElement)?.closest(".item[data-part]");
  const row = item(sel.anchorNode);
  if (!row || row !== item(sel.focusNode)) return;
  const entry = entryById(Number(row.dataset.id));
  if (!entry || entry.pending) return;
  const part = row.dataset.part;
  if (part === "result" && entry.result?.latex === undefined) return;
  e.clipboardData.setData("text/plain", part === "input" ? entry.input : textFor({ id: entry.id, part }));
  e.preventDefault();
});
document.addEventListener("keydown", (e) => {
  // typing anywhere lands in the input
  if (catalogEl.hidden && memoryEl.hidden && helpEl.hidden && document.activeElement !== editorElement() && !e.metaKey && !e.ctrlKey) {
    focusEditor();
  }
});

// --- math input ------------------------------------------------------------------

function editorElement() {
  return state.mode === "math" ? mathField : input;
}

function focusEditor() {
  editorElement().focus();
}

function insertMath(latex) {
  // #0 takes the selection; with nothing selected make it an empty box to type into
  if (mathField.selectionIsCollapsed) latex = latex.replaceAll("#0", "#?");
  mathField.focus();
  mathField.insert(latex, { format: "latex", selectionMode: latex.includes("#?") ? "placeholder" : "after" });
  schedulePreview();
}

let mathLiveLoading = null;

function loadMathLive() {
  if (window.MathfieldElement) return Promise.resolve();
  mathLiveLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MATHLIVE_URL;
    script.onload = resolve;
    script.onerror = () => {
      mathLiveLoading = null;
      reject(new Error("Couldn't load the math input (MathLive) from the CDN"));
    };
    document.head.append(script);
  });
  return mathLiveLoading;
}

// MathLive's ~260 built-in shortcuts fire inside longer words (int|egrate,
// exp|and -> \exp\land), so use a small set instead, plus every known function
// name: those render upright, and MathLive upgrades to the longest match as you
// type (sin -> sinh, exp -> expand), so prefixes don't get stuck.
const MATH_SHORTCUTS = {
  sqrt: "\\sqrt{#?}", cbrt: "\\sqrt[3]{#?}", pi: "\\pi", oo: "\\infty", infty: "\\infty",
  int: "\\int", sum: "\\sum", prod: "\\prod", lim: "\\lim",
  "->": "\\to", "<=": "\\le", ">=": "\\ge", "!=": "\\ne", "*": "\\cdot",
  alpha: "\\alpha", beta: "\\beta", gamma: "\\gamma", delta: "\\delta", epsilon: "\\epsilon",
  zeta: "\\zeta", theta: "\\theta", lambda: "\\lambda", mu: "\\mu", rho: "\\rho",
  sigma: "\\sigma", tau: "\\tau", phi: "\\phi", omega: "\\omega",
};

function configureMathShortcuts() {
  if (!mathField) return;
  const shortcuts = { ...MATH_SHORTCUTS };
  for (const entry of state.catalog) {
    if (/^[A-Za-z]{2,}$/.test(entry.name) && entry.insert.endsWith("(") && !(entry.name in shortcuts)) {
      shortcuts[entry.name] = KATEX_FUNCS.has(entry.name) ? `\\${entry.name}` : `\\operatorname{${entry.name}}`;
    }
  }
  for (const name of KATEX_FUNCS) shortcuts[name] = `\\${name}`;
  mathField.inlineShortcuts = shortcuts;
}

function createMathField() {
  mathField = new window.MathfieldElement();
  mathField.id = "mathinput";
  input.after(mathField); // MathLive rejects most options until the field is mounted
  mathField.mathVirtualKeyboardPolicy = "manual";
  mathField.mathModeSpace = "\\,"; // keep spaces (sin x) instead of using space to navigate
  mathField.menuItems = [];
  mathField.setAttribute("aria-label", "Expression");
  window.MathfieldElement.soundsDirectory = null;
  configureMathShortcuts();
  // capture phase: runs before MathLive sees the key, so we can take the ones we own
  mathField.addEventListener("keydown", onMathKey, true);
  mathField.addEventListener("input", schedulePreview);
}

function stop(e) {
  e.preventDefault();
  e.stopPropagation();
}

function onMathKey(e) {
  if (e.key === "c" && e.ctrlKey && busy() && mathField.selectionIsCollapsed) {
    stop(e);
    send({ type: "interrupt" });
    return;
  }
  if (e.key === "m" && e.ctrlKey) {
    stop(e);
    toggleMode();
    return;
  }
  if (isUndoKey(e, !mathField.value)) {
    stop(e);
    undo();
    return;
  }
  if (state.selected) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const graphKeys = state.selected.part === "graph" ? ["ArrowLeft", "ArrowRight", "+", "=", "-", "0"] : [];
    if (["ArrowUp", "ArrowDown", "Enter", "Escape", "f", "d", "c", "C", "Backspace", "Delete", ...graphKeys].includes(e.key)) {
      stop(e);
      browseKey(e);
    } else select(null); // and the key reaches the math field
    return;
  }
  const empty = !mathField.value;
  if (e.key === "ArrowUp") {
    // inside a fraction ↑ moves to the numerator; only when it can't move does it open the history
    stop(e);
    const before = mathField.position;
    mathField.executeCommand("moveUp");
    if (mathField.position === before) moveSelection(-1);
  } else if (e.key === "Enter") {
    stop(e);
    submit();
  } else if (e.key === "Escape") {
    stop(e);
    clearEditor();
  } else if (e.key === "Tab") {
    stop(e);
    mathField.executeCommand(e.shiftKey ? "moveToPreviousPlaceholder" : "moveToNextPlaceholder");
  } else if (e.key === "?" && empty) {
    stop(e);
    openCatalog("");
  } else if (e.key === "-" && mathField.value === "\\mathrm{ans}-") {
    stop(e);
    mathField.value = "-"; // a second "-" means a negative number
    mathField.position = mathField.lastOffset;
    schedulePreview();
  } else if (CONTINUE_OPS.includes(e.key) && empty) {
    // continue from ans; the operator itself goes through, so / still makes a fraction
    mathField.insert("\\mathrm{ans}", { format: "latex", selectionMode: "after" });
  }
}

const conversions = new Map(); // preview seq -> resolve, for text -> math
let conversionSeq = 0;

function textToLatex(src) {
  return new Promise((resolve) => {
    const seq = ++conversionSeq;
    conversions.set(seq, resolve);
    if (!send({ type: "preview", target: "convert", seq, src })) {
      conversions.delete(seq);
      resolve(null);
    }
  });
}

async function setMode(mode, { convert = true } = {}) {
  if (mode === state.mode && (mode === "text" || mathField)) return;
  select(null);
  if (mode === "math") {
    try {
      await loadMathLive();
    } catch (e) {
      flash(e.message);
      return;
    }
    if (!mathField) createMathField();
    const src = input.value.trim();
    let latex = "";
    if (convert && src) {
      latex = await textToLatex(src);
      if (latex === null) {
        flash("Can't show this as math (Python, or not finished?)");
        return;
      }
    }
    mathField.value = latex;
    input.value = "";
  } else {
    let src = "";
    if (convert && mathField?.value) {
      try {
        src = latexToCalc(mathField.value);
      } catch (e) {
        flash(`Can't turn this into text yet: ${e.message}`);
        return;
      }
    }
    if (mathField) mathField.value = "";
    input.value = src;
  }
  state.mode = mode;
  document.activeElement?.blur();
  document.body.classList.toggle("math-mode", mode === "math");
  try {
    localStorage.setItem("calc.mode", mode);
  } catch {}
  // focus once the switch has been laid out: hiding the focused editor in the same
  // frame makes Chrome drop focus to <body> after we've moved it
  requestAnimationFrame(() => {
    focusEditor();
    if (mode === "math") mathField.position = mathField.lastOffset;
    else input.setSelectionRange(input.value.length, input.value.length);
  });
  schedulePreview();
  renderHints();
  renderModeButton();
}

function toggleMode() {
  setMode(state.mode === "math" ? "text" : "math");
}

const modeButton = document.getElementById("mode-toggle");

function renderModeButton() {
  // a toggle: grey when off, lit while the math input is on
  const on = state.mode === "math";
  modeButton.textContent = "Math input";
  setTip(
    modeButton,
    on
      ? "On. Ctrl+M or click to go back to plain text"
      : "Type math as it looks, like in Desmos: / makes a fraction, ^ an exponent (Ctrl+M)",
  );
  modeButton.setAttribute("aria-pressed", String(on));
}

modeButton.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
modeButton.addEventListener("click", toggleMode);

function restoreMode() {
  let saved = null;
  try {
    saved = localStorage.getItem("calc.mode");
  } catch {}
  if (saved === "math") setMode("math", { convert: false });
}

// --- startup progress ---------------------------------------------------------------

const loadingEl = document.getElementById("loading");

function renderLoading(progress) {
  loadingEl.hidden = !progress;
  if (!progress) return;
  const percent = Math.round(progress.fraction * 100);
  loadingEl.querySelector(".fill").style.width = `${percent}%`;
  loadingEl.querySelector(".bar").setAttribute("aria-valuenow", String(percent));
  loadingEl.querySelector(".label").textContent = progress.text;
}

// --- backend ------------------------------------------------------------------------
//
// Python runs in the page (backend.js + worker.js); messages to and from it are the
// ones a server would exchange.

const backend = new Backend(onMessage);

function send(message) {
  return backend.handle(message);
}

function onMessage(msg) {
  if (msg.type === "status") {
    renderLoading(msg.fraction === null ? null : msg);
    state.status = msg.fraction === null ? msg.text : null; // the bar shows startup progress
    renderHints();
  } else if (msg.type === "init") {
    // the saved tape, before Python is up; keep anything already submitted meanwhile
    state.entries = [...msg.entries, ...state.entries.filter((e) => e.pending)];
    state.selected = null;
    renderTape();
  } else if (msg.type === "ready") {
    state.ready = true;
    state.catalog = msg.catalog;
    state.names = msg.names;
    configureMathShortcuts();
    renderHints();
  } else if (msg.type === "tape") {
    state.entries = msg.entries;
    state.selected = null;
    renderTape();
  } else if (msg.type === "pending") {
    const entry = { id: msg.id, input: msg.input, input_latex: msg.input_latex, pending: true };
    state.entries.push(entry);
    replaceEntryNode(entry);
    scrollToBottom();
  } else if (msg.type === "entry") {
    state.names = msg.names;
    const i = state.entries.findIndex((e) => e.id === msg.entry.id);
    if (i === -1) state.entries.push(msg.entry);
    else state.entries[i] = msg.entry;
    scrollToBottomAfterImages(replaceEntryNode(msg.entry));
  } else if (msg.type === "preview") {
    onPreview(msg);
  } else if (msg.type === "names") {
    state.names = msg.names;
  } else if (msg.type === "vars") {
    onVariables(msg);
  } else if (msg.type === "undone") {
    flash(msg.text);
  } else if (msg.type === "samples") {
    graphSamples(msg); // graph.js
  }
}

renderPalette();
renderCommands();
renderAbout();
renderHints();
renderModeButton();
backend.start();
restoreMode();
