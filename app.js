// Calculator frontend: a tape of entries and one input line. The keypad, its screen and
// its views (keypad.js) are built on top of this, and drive it through the same keys a
// keyboard would send.
//
// Focus never leaves the input. "Browsing" the tape is just a selection: while something
// is selected, ↑/↓/⏎/f/c/Esc act on it and any other key drops the selection and types
// normally.
//
// The input line is either a text <input> or, after Ctrl+M (or setup's Input), a MathLive
// math field (loaded on first use). The math field's LaTeX is turned back into calculator
// syntax by latex.js, so both modes send Python the same thing.

const tapeEl = document.getElementById("tape");
const input = document.getElementById("input");
const promptEl = document.getElementById("prompt");
const previewEl = document.getElementById("preview");

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
  status: null, // what's loading or failing, shown on the status line (startup has a bar)
  flash: null,
  mode: "text", // or "math"
  approxNext: false, // the next entry shows its result as a decimal (submit)
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
  const relation = isFloat && !r.float.exact ? "\\approx" : "=";
  if (r.label) return `${r.label} ${relation} ${body}`;
  return relation === "=" ? body : `${relation} ${body}`;
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
  const relation = isFloat && !r.float.exact ? "\\approx" : "=";
  renderItems(node, r.label ? `${r.label} ${relation}` : relation === "=" ? "" : relation, items);
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
  inRow.append(el("span", "num", `$${entry.id}`));
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
  renderSelection();
  scrollToBottomAfterImages(tapeEl);
}

function replaceEntryNode(entry) {
  const old = tapeEl.querySelector(`.entry[data-id="${entry.id}"]`);
  const node = renderEntry(entry);
  if (old) old.replaceWith(node);
  else tapeEl.append(node);
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

// What can be done with the selection, and the key that does it on a keyboard: the
// keypad's soft keys show them (keypad.js's selectionKeys; chip is the label there)
function selectionActions() {
  const entries = selectedEntries();
  const { id, part } = state.selected;
  const entry = entryById(id);
  const actions = [];
  const add = (key, label, run, extra = {}) => actions.push({ key, label, run, ...extra });
  if (entries.length > 1) {
    add("c", `Copy ${entries.length}`, copySelected);
    add("⌫", `Delete ${entries.length}`, deleteSelected, { danger: true });
  } else {
    add("⏎", "Insert", insertSelected);
    if (part === "graph") {
      add("+", "Zoom in", () => graphKey(id, "+")); // graph.js
      add("−", "Zoom out", () => graphKey(id, "-"));
      add("0", "Reset", () => graphKey(id, "0"));
    }
    if (part === "result" && entry?.result?.float) add("f", entry.view === "float" ? "Exact" : "Decimal", () => toggleView("float"));
    if (part === "result" && entry?.result?.degrees) add("d", entry.view === "degrees" ? "Radians" : "Degrees", () => toggleView("degrees"));
    add("c", "Copy", copySelected);
    if (part === "result" ? entry?.result?.latex !== undefined : entry?.input_latex) add("⇧C", "LaTeX", copyLatex);
    add("⌫", "Delete", deleteSelected, { danger: true });
  }
  add("⇧↑", "More", () => extendSelection(-1), { chip: "More ↑" });
  add("⇧↓", "More", () => extendSelection(1), { chip: "More ↓" });
  add("Esc", "Back", () => select(null), { chip: "✕" });
  return actions;
}

const UNDO_HINT = /\s*·\s*<kbd>⌃Z<\/kbd> undo/; // in flash messages: an undo link instead

// The status line and the soft keys (keypad.js) say what's going on
function renderHints() {
  renderStrip();
}

function flash(message) {
  state.flash = message;
  renderHints();
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    state.flash = null;
    renderHints();
  }, UNDO_HINT.test(message) ? 5000 : 1500); // time to tap undo
}

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

// --- function keys: the touch keypad's (keypad.js, menus.json) ------------------------
//
// A key's template marks the cursor with "|"; selected text in the input lands there, so
// selecting x+1 and pressing √ gives sqrt(x+1).

// A key that inserts something (a template, or text), in either input
function insertKey(spec) {
  if (state.mode === "math" && spec.math === null) {
    flash("Only in text input: ⌃M");
    return;
  }
  const template = spec.template ?? spec.type;
  const empty = state.mode === "math" ? !mathField.value : !input.value;
  // a key that wraps what comes next (1/x) applies to the last result on an empty line
  if (empty && spec.ans) {
    insertTemplate(spec.ans, spec.math.replaceAll("#0", "\\mathrm{ans}"));
    return;
  }
  insertTemplate(spec.method && empty ? `ans${template}` : template, spec.math ?? template);
}

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

// --- commands (:help, :catalog, :vars, :clear, :reset) ---------------------------------

// The catalog, :vars and :help are the keypad's views, which put their openers here
// (keypad.js's setupKeypad): catalog(query, replaceFrom), vars(), help(), and varsChanged(error)
// for when the variables arrive (memoryState.items)
const panels = {};

const COMMANDS = {
  help: { help: "how to type things: syntax, vectors and matrices, Python, keys", run: () => panels.help() },
  catalog: { help: "the functions, searchable, with examples (? on an empty line)", run: () => panels.catalog() },
  vars: { help: "show everything you've defined, with its value", run: () => panels.vars() },
  clear: { help: "empty the tape (also ⌃L); variables are kept (⌃Z brings it back)", run: clearTape },
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
  panels.catalog(prefix, prefix ? start : null);
}

// shift enter (Shift+⏎ on a keyboard): evaluate, showing the result as a decimal; with
// nothing typed, the selected result (or the last one) as a decimal, or exact again
function submitApprox() {
  const empty = state.mode === "math" ? !mathField?.value : !input.value.trim();
  if (!empty) return submit({ approx: true });
  const id = state.selected?.part === "result" ? state.selected.id : state.entries.findLast((e) => e.result)?.id;
  const entry = id && entryById(id);
  if (!entry) return;
  if (!entry.result.float && entry.view !== "float") return flash("This one has no other decimal form");
  entry.view = entry.view === "float" ? "exact" : "float";
  replaceEntryNode(entry);
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

// Ctrl+C while nothing runs abandons the line, as Python's prompt does: it goes on the
// tape, unrun, with KeyboardInterrupt under it
function cancelLine() {
  let src;
  try {
    src = editorSource();
  } catch {
    src = mathField.value.trim(); // math input that doesn't read as text yet
  }
  if (!src) return;
  select(null);
  send({ type: "cancel", src });
  clearEditor();
}

// Ctrl+C (with no text selected, so it isn't a copy) and Ctrl+L, in either input
function controlKey(e, collapsed) {
  if (!e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key === "c" && collapsed) {
    if (busy()) send({ type: "interrupt" });
    else cancelLine();
  } else if (e.key === "l") clearTape();
  else return false;
  return true;
}

// approx: show the result as a decimal (shift enter, Shift+⏎), when it has one
function submit({ approx = false } = {}) {
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
  } else {
    state.approxNext = approx; // the entry it starts (pending) remembers it
    sent = send({ type: "eval", src });
  }
  if (!sent) {
    state.approxNext = false;
    flash("Python is still loading, so nothing was sent");
    return; // keep what was typed
  }
  clearEditor();
}

input.addEventListener("keydown", (e) => {
  if (controlKey(e, input.selectionStart === input.selectionEnd)) {
    e.preventDefault();
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
    if (e.shiftKey) submitApprox();
    else submit();
  } else if (e.key === "Escape") {
    input.value = "";
    clearPreview();
  } else if (e.key === "Tab") {
    e.preventDefault();
    complete();
  } else if (e.key === "?" && input.value === "") {
    e.preventDefault();
    panels.catalog();
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
    const target = catalogState.exampleNode;
    if (target?.isConnected && msg.seq === catalogState.exampleSeq && msg.latex) tex(target, msg.latex);
  }
}

// --- catalog -----------------------------------------------------------------

// An entry's example is typeset by the preview: the reply lands in exampleNode
const catalogState = { exampleSeq: 0, exampleNode: null };

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

// An entry's details into node: signature, summary, its example (typeset by the preview,
// when it comes back), its docs and its related entries (onSee(name) follows one)
function renderCatalogEntry(node, entry, onSee) {
  node.append(el("h2", "", entry.name));
  if (entry.signature) node.append(el("div", "sig", entry.signature));
  if (entry.summary) node.append(el("p", "summary", entry.summary));
  if (entry.example) {
    const ex = el("div", "example");
    ex.append(el("code", "", entry.example));
    const math = el("div", "example-math");
    node.append(ex, math);
    if (!entry.example.startsWith(":")) {
      catalogState.exampleNode = math;
      send({ type: "preview", target: "catalog", seq: ++catalogState.exampleSeq, src: entry.example });
    }
  }
  if (entry.doc && entry.doc !== entry.summary) node.append(el("pre", "", entry.doc));
  const names = new Set(catalogEntries().map((e) => e.name));
  const related = (entry.see ?? []).filter((name) => names.has(name));
  if (!related.length) return;
  const see = el("p", "see", "See also ");
  related.forEach((name, i) => {
    if (i) see.append(" · ");
    const link = el("button", "", name);
    link.type = "button";
    link.tabIndex = -1;
    link.addEventListener("mousedown", (e) => e.preventDefault()); // keep the focus where it is
    link.addEventListener("click", () => onSee(name));
    see.append(link);
  });
  node.append(see);
}

function catalogMath(entry) {
  const name = entry.name;
  const fn = name === "log" ? "\\ln" : KATEX_FUNCS.has(name) ? `\\${name}` : `\\operatorname{${name}}`;
  if (entry.insert.endsWith("(") && /^\w+\($/.test(entry.insert)) return `${fn}\\left(#0\\right)`;
  if (/^\w+$/.test(entry.insert)) return name.length > 1 ? `\\mathrm{${name}}` : name;
  return null; // methods (.subs), commands (:clear), syntax notes
}

// An entry into the line: its text (replacing the word being completed, from replaceFrom)
// or, in math input, its LaTeX
function insertCatalogEntry(entry, replaceFrom = null) {
  if (state.mode === "math") {
    const special = { pi: "\\pi", oo: "\\infty", E: "e", I: "i" }[entry.name];
    const latex = special ?? catalogMath(entry);
    focusEditor();
    if (latex) insertMath(latex);
    else flash(`${entry.name}: switch to text input (⌃M) for this one`);
    return;
  }
  input.focus();
  if (replaceFrom !== null) input.setSelectionRange(input.selectionStart, input.selectionStart);
  insertAtCursor(entry.insert, replaceFrom);
}

// --- memory: what's defined, with values (:vars) -------------------------------

const memoryState = { items: [] };

// Python sends what's defined, with values: they arrive in memoryState.items
// (panels.varsChanged), as they do again after a forget and its undo
function requestVariables() {
  return send({ type: "vars" });
}

function onVariables(msg) {
  memoryState.items = msg.items;
  panels.varsChanged(msg.error);
}

// Forgets a name defined in the calculator (not ans); the list comes back without it
function forgetVariable(name) {
  if (name === "ans") return;
  send({ type: "forget", name });
  flash(`Forgot ${name} · <kbd>⌃Z</kbd> undo`);
}

// A name into the line; a function's with its brackets, the cursor between them
function insertName(name, fn = false, replaceFrom = null) {
  if (state.mode === "math") {
    const latex = name.length > 1 ? `\\mathrm{${name}}` : name;
    insertMath(fn ? `${latex}\\left(#?\\right)` : latex);
  } else insertAtCursor(fn ? `${name}(` : name, replaceFrom);
}

// --- taps and clicks on the tape: they shouldn't strand the focus ------------------

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
  if (document.activeElement !== editorElement() && !e.metaKey && !e.ctrlKey) focusEditor();
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
  if (controlKey(e, mathField.selectionIsCollapsed)) {
    stop(e);
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
    panels.catalog();
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
}

function toggleMode() {
  setMode(state.mode === "math" ? "text" : "math");
}

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
    const entry = { id: msg.id, input: msg.input, input_latex: msg.input_latex, pending: true, approx: state.approxNext };
    state.approxNext = false;
    state.entries.push(entry);
    replaceEntryNode(entry);
    scrollToBottom();
  } else if (msg.type === "entry") {
    state.names = msg.names;
    const i = state.entries.findIndex((e) => e.id === msg.entry.id);
    if (state.entries[i]?.approx && msg.entry.result?.float) msg.entry.view = "float";
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

renderHints();
backend.start();
restoreMode();
