// Touch layout: a calculator keypad under the input, for phones and tablets without a
// mouse. A script in index.html's <head> marks <html class="touch"> before anything
// renders (a touch-only device, or ?layout=touch); without it nothing here runs and the
// page is the keyboard one. touch.css styles all of it, under html.touch.
//
// The keys drive the code the keyboard does. A character key first dispatches a keydown
// on the editor, so app.js's rules apply unchanged (an operator on an empty line
// continues from ans, ⏎ on a selected result inserts it, ⌫ deletes it, ← → pan a
// selected graph), and types the character only if app.js left it alone. Function keys
// go through insertTemplate, as the palette's buttons do, in text and math input alike.
//
// The input keeps its caret but asks for no system keyboard (inputmode="none"); abc
// brings the system keyboard up, with a row of the symbols it hides, and 123 puts it
// away. Hover tips become long presses: holding a key says what it does, and offers
// related keys (slide onto one, or let go and tap it). The strip above the keys does
// the hint line's job: what you can insert, what you can do with a selected result,
// messages, and Undo.

const TOUCH = document.documentElement.classList.contains("touch");
const HOLD_MS = 450; // a long press
const REPEAT_MS = [400, 70]; // ◀ ▶ held: the first repeat, then every

const touch = {
  page: "xy", // the side block's page
  typing: false, // the system keyboard is up (abc)
  press: null, // the key being pressed: {key, spec, id, timer, held, cell}
  popup: null, // a long press's popup
  menu: null, // ⋯
  switching: false, // moving the focus on purpose: not the system keyboard going away
  resetArmed: 0,
  tappedFn: null, // the catalog item tapped once (on a wide screen the first tap shows it)
};
const keySpecs = new WeakMap(); // button -> its key
let keypadEl = null;
let stripEl = null;

// --- the keys ----------------------------------------------------------------------
//
// A key is {label, tex?, word?, kind?, tip?, alts?} plus what it does: type (characters,
// with math for the math input's LaTeX if typing them there isn't right), template and
// math (as the palette's: | is the cursor, #0 the selection, #? an empty box; math null
// means text input only; method: on an empty line it applies to ans), or action.

const typed = (label, type, extra = {}) => ({ label, type, ...extra });
const letter = (name, extra = {}) => typed(name, name, { tex: true, ...extra });
const greek = (name) => typed(`\\${name}`, name, { tex: true, math: `\\${name}` });
const fn = (label, template, math, tip, extra = {}) => ({ label, tex: true, template, math, tip, ...extra });
const word = (text, template, math, tip, extra = {}) => ({ word: text, template, math, tip, ...extra });

// one of app.js's PALETTE entries, by its label
function palette(label, extra = {}) {
  const [, template, math, tip] = PALETTE.flat().find(([l]) => l === label);
  return { label, tex: true, template, math, tip, ...extra };
}

// The side block's pages, 3 × 4 keys each; built on use, since PALETTE is app.js's
function sidePages() {
  return {
    xy: [
      letter("x", { tip: "A symbol, as is any name that isn't defined", alts: ["t", "z", "n", "k"].map((n) => letter(n)).concat(greek("theta")) }),
      letter("y", { tip: "A symbol", alts: ["z", "a", "b", "c"].map((n) => letter(n)) }),
      typed("=", "=", {
        tip: "Assigns (a = 3), defines (f(x) = x²) or makes an equation (x² = 4)",
        alts: [typed("<", "<"), typed(">", ">"), typed("≤", "<=", { math: "\\le" }), typed("≥", ">=", { math: "\\ge" }), typed("≠", "!=", { math: "\\ne" }), typed("==", "==", { word: "==", tip: "Same expression? True or False" })],
      }),
      palette("x^2", { alts: [fn("x^3", "^3", "^3", "Cubes what's before the cursor"), fn("x^{-1}", "^-1", "^{-1}", "One over what's before the cursor")] }),
      palette("x^n"),
      palette("\\sqrt{x}", { alts: [palette("\\sqrt[n]{x}")] }),
      palette("\\pi"),
      palette("e"),
      palette("i"),
      palette("\\frac{a}{b}"),
      palette("|x|"),
      palette("\\infty"),
    ],
    fx: [
      palette("\\sin", { alts: [fn("\\sinh", "sinh(|)", "\\sinh\\left(#0\\right)", "Hyperbolic sine")] }),
      palette("\\cos", { alts: [fn("\\cosh", "cosh(|)", "\\cosh\\left(#0\\right)", "Hyperbolic cosine")] }),
      palette("\\tan", { alts: [fn("\\tanh", "tanh(|)", "\\tanh\\left(#0\\right)", "Hyperbolic tangent")] }),
      fn("\\sin^{-1}", "asin(|)", "\\arcsin\\left(#0\\right)", "The angle whose sine this is, in radians: asin(1) = π/2"),
      fn("\\cos^{-1}", "acos(|)", "\\arccos\\left(#0\\right)", "The angle whose cosine this is, in radians"),
      fn("\\tan^{-1}", "atan(|)", "\\arctan\\left(#0\\right)", "The angle whose tangent this is, in radians: atan(1) = π/4"),
      palette("\\ln"),
      palette("\\log_b", { alts: [fn("\\log_2", "log(|, 2)", "\\log_{2}\\left(#0\\right)", "Base 2: log₂ 8 = 3")] }),
      palette("e^x"),
      palette("x^\\circ"),
      palette("n!"),
      palette("\\tbinom{n}{k}"),
    ],
    calc: [
      palette("\\frac{d}{dx}"),
      palette("\\int"),
      palette("\\int_a^b"),
      palette("\\lim"),
      palette("\\sum"),
      palette("\\text{solve}", { word: "solve" }),
      palette("\\text{simplify}", { word: "simplify" }),
      palette("\\text{factor}", { word: "factor" }),
      palette("\\text{expand}", { word: "expand" }),
      palette("\\text{plot}", { word: "plot" }),
      word("iplot", "iplot(|)", "\\operatorname{iplot}\\left(#0\\right)", "A graph you can drag and pinch: iplot(sin(x)/x)"),
      word("series", "series(|, x, 0, 6)", "\\operatorname{series}\\left(#0, x, 0, 6\\right)", "Taylor series around 0, up to x⁶ (edit after inserting)"),
    ],
    mat: [
      word("M[ ]", "M[|]", "\\begin{bmatrix}#0 & #?\\\\ #? & #?\\end{bmatrix}", "A matrix: M[1, 2] is one row, M[[1, 2], [3, 4]] two"),
      word("V[ ]", "V[|]", "\\begin{bmatrix}#0\\\\ #?\\end{bmatrix}", "A column vector: V[1, 2]"),
      fn("[\\,]", "[|]", "\\left[#0\\right]", "The rows in M[[1, 2], [3, 4]]; parts of a matrix: A[0, 1], A[1, :]"),
      fn("\\det", "det(|)", "\\det\\left(#0\\right)", "Determinant"),
      fn("A^{-1}", "^-1", "^{-1}", "Inverse of what's before the cursor (on an empty line, the last result)"),
      fn("A^{T}", ".T", null, "Transpose of what's before the cursor", { method: true }),
      fn("u\\cdot v", ".dot(|)", null, "Dot product: v.dot(w)", { method: true }),
      fn("u\\times v", ".cross(|)", null, "Cross product: v.cross(w)", { method: true }),
      typed(":", ":", { tip: "A whole row or column: A[1, :], A[:, 0]" }),
      word("eigen", ".eigenvals()", null, "Eigenvalues, each with how many times it appears", { method: true }),
      word("rref", ".rref()", null, "Reduced row echelon form, and the pivot columns", { method: true }),
      word("eye", "eye(|)", "\\operatorname{eye}\\left(#0\\right)", "The identity matrix: eye(3)"),
    ],
  };
}

const PAGES = [
  ["xy", "x\\,y", "Symbols, powers, roots, constants"],
  ["fx", "f(x)", "Trigonometry, logarithms, factorials"],
  ["calc", "\\textstyle\\int", "Calculus and algebra"],
  ["mat", "[\\,]", "Matrices and vectors"],
];

const op = (label, type, extra = {}) => typed(label, type, { kind: "op", ...extra });

// The number pad, 4 × 4, right of the side block
// ⌫ top right, as on most calculators; + moves down next to ⏎ to make room
const PAD = [
  typed("7", "7"), typed("8", "8"), typed("9", "9"), { label: "⌫", kind: "ctl", action: backspace, hold: clearLine, tip: "Hold to clear the line" },
  typed("4", "4"), typed("5", "5"), typed("6", "6"), op("÷", "/", { alts: [typed("%", "%", { tip: "Remainder: 7 % 3 = 1" })] }),
  typed("1", "1"), typed("2", "2"), typed("3", "3"), op("×", "*"),
  typed("0", "0"), typed(".", "."), typed(",", ",", { alts: [typed(":", ":"), typed(";", ";")] }), op("−", "-"),
];

// The bottom row, across both blocks
const BOTTOM = [
  { label: "◀", kind: "ctl", repeat: true, action: () => moveCaret(-1) },
  { label: "▶", kind: "ctl", repeat: true, action: () => moveCaret(1) },
  typed("ans", "ans", { word: "ans", kind: "fn", math: "\\mathrm{ans}", tip: "The last result; an operator on an empty line continues from it", alts: [typed("$", "$", { tip: "$3 is entry 3's result" })] }),
  typed("(", "(", { kind: "fn", alts: [typed("[", "["), typed("{", "{")] }),
  typed(")", ")", { kind: "fn", alts: [typed("]", "]"), typed("}", "}")] }),
  op("+", "+"),
  { label: "⏎", kind: "enter", action: enter },
];

// Over the system keyboard (abc): what it hides on its second and third pages
const BAR = [
  { label: "123", kind: "ctl", action: () => setTyping(false) },
  typed("(", "(", { alts: [typed("[", "["), typed("{", "{")] }),
  typed(")", ")", { alts: [typed("]", "]"), typed("}", "}")] }),
  typed("^", "^"),
  typed("*", "*"),
  typed("=", "="),
  typed(",", ","),
];

function keyButton(spec, extraClass = "") {
  const b = el("button", ["key", spec.kind, spec.word && "word", spec.alts && "more", extraClass].filter(Boolean).join(" "));
  b.type = "button";
  b.tabIndex = -1;
  if (spec.word) b.textContent = spec.word;
  else if (spec.tex) tex(b, spec.label, false);
  else b.textContent = spec.label;
  if (spec.tip) b.setAttribute("aria-label", spec.tip);
  keySpecs.set(b, spec);
  return b;
}

function renderKeys() {
  const pages = sidePages();
  const keys = keypadEl.querySelector(".keys");
  const tabs = el("div", "tabs");
  const left = el("div", "group");
  const right = el("div", "group");
  for (const [name, label, tip] of PAGES) {
    left.append(keyButton({ label, tex: true, tip, kind: touch.page === name ? "tab active" : "tab", action: () => setPage(name) }));
  }
  right.append(
    keyButton({ label: "abc", kind: "tab", tip: "The system keyboard, for names and Python", action: () => setTyping(true) }),
    keyButton({ label: "?", kind: "tab", tip: "All the functions", action: () => openCatalog("") }),
    keyButton({ label: "⋯", kind: "tab menu-key", tip: "Math input, variables, help, clear", action: toggleMenu }),
  );
  tabs.append(left, right);
  const grid = el("div", "grid");
  const side = pages[touch.page];
  for (let row = 0; row < 4; row++) {
    for (const spec of side.slice(row * 3, row * 3 + 3)) grid.append(keyButton(spec, "side"));
    for (const spec of PAD.slice(row * 4, row * 4 + 4)) grid.append(keyButton(spec));
  }
  for (const spec of BOTTOM) grid.append(keyButton(spec));
  keys.replaceChildren(tabs, grid);
}

function setPage(name) {
  touch.page = name;
  renderKeys();
}

// --- what the keys do --------------------------------------------------------------

// A keydown on the editor, as if typed; true if app.js handled it
function sendKey(key, options = {}, target = editorElement()) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function editorEmpty() {
  return state.mode === "math" ? !mathField.value : !input.value;
}

// After any edit: keep the caret visible, and the preview and the strip current
function edited() {
  if (document.activeElement !== editorElement()) focusEditor();
  schedulePreview();
  renderStrip();
}

function activate(spec) {
  if (spec.action !== toggleMenu) hideMenu();
  if (spec.action) spec.action();
  else if (spec.template !== undefined) insertKeyTemplate(spec);
  else typeText(spec.type, spec.math);
}

function typeText(text, math) {
  if (state.selected) select(null);
  if (!(text.length === 1 && sendKey(text))) {
    if (state.mode === "math") {
      if (math) insertMath(math);
      else mathField.executeCommand(["typedText", text, { focus: true, simulateKeystroke: true }]);
    } else {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
    }
  }
  edited();
}

function insertKeyTemplate(spec) {
  if (state.selected) select(null);
  if (state.mode === "math" && spec.math === null) {
    flash("Text input only: ⋯ turns the math input off");
    return;
  }
  insertTemplate(spec.method && editorEmpty() ? `ans${spec.template}` : spec.template, spec.math);
  edited();
}

function moveCaret(delta) {
  if (sendKey(delta < 0 ? "ArrowLeft" : "ArrowRight")) return; // pans a selected graph
  focusEditor();
  if (state.mode === "math") mathField.executeCommand(delta < 0 ? "moveToPreviousChar" : "moveToNextChar");
  else {
    const { selectionStart: start, selectionEnd: end, value } = input;
    const at = start !== end ? (delta < 0 ? start : end) : Math.max(0, Math.min(value.length, start + delta));
    input.setSelectionRange(at, at);
  }
  renderStrip();
}

function backspace() {
  if (sendKey("Backspace")) return; // deleted the selected tape entries (app.js)
  if (state.mode === "math") mathField.executeCommand("deleteBackward");
  else {
    let { selectionStart: start, selectionEnd: end } = input;
    if (start === end && start > 0) start -= 1;
    input.setRangeText("", start, end, "end");
  }
  edited();
}

function clearLine() {
  if (state.selected) select(null);
  clearEditor();
  edited();
}

function enter() {
  sendKey("Enter"); // evaluates, or inserts the selected tape item
  edited();
}

// --- pressing ------------------------------------------------------------------------
//
// Keys act when let go. Held, a key repeats (◀ ▶), does its hold action (⌫ clears), or
// opens a popup with its tip and related keys: slide onto one and let go, or let go and
// tap one. One key at a time.

function onPointerDown(e) {
  const key = e.target.closest?.(".key");
  if (!key || !keypadEl.contains(key)) return;
  e.preventDefault(); // keep the focus in the input
  if (touch.press) return;
  const inPopup = touch.popup?.contains(key);
  if (touch.popup && !inPopup) closePopup();
  const spec = keySpecs.get(key);
  key.setPointerCapture?.(e.pointerId);
  key.classList.add("down");
  const press = { key, spec, id: e.pointerId, held: false, cell: null, timer: null };
  touch.press = press;
  if (inPopup) return;
  if (spec.repeat) {
    const repeat = () => {
      press.held = true;
      activate(spec);
      press.timer = setTimeout(repeat, REPEAT_MS[1]);
    };
    press.timer = setTimeout(repeat, REPEAT_MS[0]);
  } else if (spec.hold || spec.alts || spec.tip) {
    press.timer = setTimeout(() => {
      press.held = true;
      if (spec.hold) {
        key.classList.remove("down");
        spec.hold();
      } else openPopup(key, spec);
    }, HOLD_MS);
  }
}

function onPointerMove(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id || !touch.popup) return;
  const under = document.elementFromPoint(e.clientX, e.clientY)?.closest(".key");
  press.cell = under && touch.popup.contains(under) ? under : null;
  touch.popup.querySelectorAll(".key").forEach((k) => k.classList.toggle("hot", k === press.cell));
}

function onPointerUp(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id) return;
  touch.press = null;
  clearTimeout(press.timer);
  press.key.classList.remove("down");
  if (press.cell) {
    // slid onto one of the popup's keys
    const spec = keySpecs.get(press.cell);
    closePopup();
    activate(spec);
  } else if (press.held) {
    // a popup with keys stays for a tap; a tip alone goes
    if (touch.popup && !touch.popup.querySelector(".key")) closePopup();
  } else {
    closePopup();
    activate(press.spec);
  }
}

function onPointerCancel(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id) return;
  touch.press = null;
  clearTimeout(press.timer);
  press.key.classList.remove("down");
}

function openPopup(key, spec) {
  closePopup();
  const popup = el("div", "popup");
  if (spec.alts) {
    const cells = el("div", "cells");
    for (const alt of spec.alts) cells.append(keyButton(alt));
    popup.append(cells);
  }
  if (spec.tip) popup.append(el("div", "hint", spec.tip));
  keypadEl.append(popup);
  // above the key, inside the keypad's width
  const box = keypadEl.getBoundingClientRect();
  const r = key.getBoundingClientRect();
  const left = r.left - box.left + r.width / 2 - popup.offsetWidth / 2;
  popup.style.left = `${Math.max(0, Math.min(left, box.width - popup.offsetWidth))}px`;
  popup.style.top = `${r.top - box.top - popup.offsetHeight - 6}px`;
  touch.popup = popup;
}

function closePopup() {
  touch.popup?.remove();
  touch.popup = null;
}

// --- the strip: suggestions, actions on the selection, messages ----------------------

function chip(label, run, className = "") {
  const b = el("button", `chip ${className}`.trim(), label);
  b.type = "button";
  b.tabIndex = -1;
  b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the input focused
  b.addEventListener("click", () => run());
  return b;
}

function note(html, className) {
  const span = el("span", `note ${className}`);
  span.innerHTML = html.replaceAll("⌃M", "⋯ → Math input");
  return span;
}

// Called by app.js's renderHints: on a touch screen the strip says what the hint line would
function renderStrip() {
  if (!stripEl) return;
  stripEl.replaceChildren();
  stripEl.scrollLeft = 0;
  if (state.status) stripEl.append(note(state.status, "status"));
  if (state.flash) {
    stripEl.append(note(state.flash.replace(/\s*·\s*<kbd>⌃Z<\/kbd> undo/, ""), "flash"));
    if (state.flash.includes("⌃Z")) stripEl.append(chip("Undo", undo, "action"));
    return;
  }
  if (state.selected) return selectionChips();
  if (busy()) stripEl.append(note("computing…", "status"), chip("Stop", () => send({ type: "interrupt" }), "action danger"));
  for (const s of suggestions()) stripEl.append(chip(s.name, () => insertSuggestion(s), s.fn ? "fn" : ""));
}

function selectionChips() {
  const entries = selectedEntries();
  const { id, part } = state.selected;
  const entry = entryById(id);
  const add = (label, run, className = "action") => stripEl.append(chip(label, run, className));
  add("✕", () => select(null), "action close");
  // deleting moves the selection on, for ↑ ↓; here nothing would show it's still there
  const remove = () => {
    deleteSelected();
    select(null);
  };
  if (entries.length > 1) {
    add(`Copy ${entries.length}`, copySelected);
    add(`Delete ${entries.length}`, remove, "action danger");
  } else {
    add("Insert", insertSelected);
    if (part === "graph") {
      add("Zoom in", () => graphKey(id, "+"));
      add("Zoom out", () => graphKey(id, "-"));
      add("Reset", () => graphKey(id, "0"));
    }
    if (part === "result" && entry?.result?.float) add(entry.view === "float" ? "Exact" : "Decimal", () => toggleView("float"));
    if (part === "result" && entry?.result?.degrees) add(entry.view === "degrees" ? "Radians" : "Degrees", () => toggleView("degrees"));
    add("Copy", copySelected);
    const hasLatex = part === "result" ? entry?.result?.latex !== undefined : !!entry?.input_latex;
    if (hasLatex) add("LaTeX", copyLatex);
    add("Delete", remove, "action danger");
  }
  add("More ↑", () => extendSelection(-1));
  add("More ↓", () => extendSelection(1));
}

// What the strip offers to insert: completions of the name being typed, else the last
// result and what's been defined
function suggestions() {
  const functions = new Set(state.names.functions);
  if (state.mode === "text") {
    const { prefix, start } = wordBeforeCursor();
    if (prefix) {
      for (const c of state.catalog) if (c.insert.endsWith("(")) functions.add(c.name);
      const names = new Set([
        ...state.names.defined,
        ...state.names.variables,
        ...state.names.functions,
        ...state.catalog.filter((c) => /^\w+$/.test(c.name)).map((c) => c.name),
      ]);
      const mine = new Set(state.names.defined);
      return [...names]
        .filter((n) => n.startsWith(prefix) && (n !== prefix || functions.has(n)))
        .sort((a, b) => mine.has(b) - mine.has(a) || a.length - b.length || a.localeCompare(b))
        .slice(0, 24)
        .map((name) => ({ name, fn: functions.has(name), start }));
    }
  }
  const list = state.entries.some((e) => e.result) ? [{ name: "ans" }] : [];
  for (const name of state.names.defined) if (name !== "ans") list.push({ name, fn: functions.has(name) });
  return list;
}

function insertSuggestion(s) {
  if (state.selected) select(null);
  if (state.mode === "math") {
    const name = s.name.length > 1 ? `\\mathrm{${s.name}}` : s.name;
    insertMath(s.fn ? `${name}\\left(#?\\right)` : name);
  } else insertAtCursor(s.fn ? `${s.name}(` : s.name, s.start ?? null);
  edited();
}

// --- abc: the system keyboard --------------------------------------------------------

function mathSink() {
  return mathField?.shadowRoot?.querySelector("[inputmode]") ?? null;
}

function setInputMode(mode) {
  input.inputMode = mode;
  mathSink()?.setAttribute("inputmode", mode);
}

// The system keyboard follows inputmode only when the editor gets the focus again, and
// iOS raises it only for a focus() made while handling a tap, which this is
function setTyping(on) {
  if (state.selected) select(null);
  touch.typing = on;
  document.documentElement.classList.toggle("typing", on);
  setInputMode(on ? "text" : "none");
  const editor = editorElement();
  touch.switching = true;
  editor.blur();
  editor.focus();
  touch.switching = false;
  renderStrip();
}

// The system keyboard was put away (or the catalog took the focus): back to the keypad
function onEditorBlur() {
  if (!touch.typing || touch.switching) return;
  setTimeout(() => {
    if (!touch.typing || document.activeElement === editorElement()) return;
    touch.typing = false;
    document.documentElement.classList.remove("typing");
    setInputMode("none");
    renderStrip();
  }, 50);
}

// The page's height follows the visual viewport, which the system keyboard shrinks
// (iOS doesn't resize the layout for it), so the input and the strip stay above it
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv || vv.scale > 1.01) return; // zoomed in: leave the layout alone
  const root = document.documentElement.style;
  root.setProperty("--app-height", `${vv.height}px`);
  root.setProperty("--app-top", `${vv.offsetTop}px`);
}

// --- ⋯ ---------------------------------------------------------------------------------

function toggleMenu() {
  if (touch.menu) return hideMenu();
  const menu = el("div", "touch-menu");
  menu.setAttribute("role", "menu");
  const loaded = (ok) => ok || flash("Python is still loading");
  const item = (label, run) => {
    const b = el("button", "", label);
    b.type = "button";
    b.tabIndex = -1;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => run() === "keep" || hideMenu());
    menu.append(b);
    return b;
  };
  item(state.mode === "math" ? "Math input: on" : "Math input: off", toggleMode);
  item("Variables", () => loaded(COMMANDS.vars.run()));
  item("Help", () => COMMANDS.help.run());
  item("Undo", undo);
  item("Clear the tape", () => loaded(COMMANDS.clear.run()));
  const reset = item("Reset…", () => {
    if (Date.now() > touch.resetArmed) {
      touch.resetArmed = Date.now() + 4000;
      reset.textContent = "Tap again to forget all variables too";
      reset.classList.add("danger");
      return "keep";
    }
    touch.resetArmed = 0;
    loaded(COMMANDS.reset.run());
  });
  item("Desktop layout", () => {
    location.search = "?layout=desktop";
  });
  const about = el("div", "about");
  const revision = document.getElementById("revision");
  const version = revision.href ? el("a", "", revision.textContent) : el("span", "", revision.textContent);
  if (revision.href) Object.assign(version, { href: revision.href, target: "_blank", rel: "noopener" });
  const source = Object.assign(el("a", "", "source"), { href: "https://github.com/jmelis/calc", target: "_blank", rel: "noopener" });
  about.append("Version ", version, " · ", source);
  menu.append(about);
  keypadEl.append(menu);
  touch.menu = menu;
}

function hideMenu() {
  touch.menu?.remove();
  touch.menu = null;
}

// Taps anywhere but on the popup's keys close it (it can cover other keys); taps
// outside the menu close the menu
function closeOnOutside(e) {
  if (touch.popup && !(touch.popup.contains(e.target) && e.target.closest?.(".key"))) closePopup();
  if (touch.menu && !touch.menu.contains(e.target) && !e.target.closest?.(".menu-key")) hideMenu();
}

// --- panels, tape, welcome --------------------------------------------------------------

function panelButton(label, run, className = "") {
  const b = el("button", className, label);
  b.type = "button";
  b.tabIndex = -1;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", run);
  return b;
}

// Full-screen on a phone (touch.css): a Done button instead of Esc and the backdrop,
// buttons instead of the keys the footers list
function setupPanels() {
  for (const [root, close] of [[catalogEl, closeCatalog], [memoryEl, closeMemory], [helpEl, closeHelp]]) {
    root.querySelector(".panel").append(panelButton("Done", close, "close"));
  }
  // a tap inserts; where the details show beside the list (a wide screen), the first tap
  // shows them and a second one inserts
  catalogList.addEventListener("click", (e) => {
    const li = e.target.closest(".fn");
    if (!li) return;
    if (getComputedStyle(catalogDetail).display === "none" || touch.tappedFn === li.dataset.index) insertFromCatalog();
    else touch.tappedFn = li.dataset.index;
  });
  catalogSearch.addEventListener("input", () => (touch.tappedFn = null));
  const memoryKey = (key, options) => () => sendKey(key, options, memoryPanel);
  memoryEl.querySelector(".footer").replaceChildren(
    panelButton("Insert", memoryKey("Enter")),
    panelButton("Forget", memoryKey("Backspace")),
    panelButton("Undo", memoryKey("z", { ctrlKey: true })),
  );
}

function setupTouch() {
  input.inputMode = "none";
  input.enterKeyHint = "go";
  keypadEl = el("div");
  keypadEl.id = "keypad";
  stripEl = el("div", "strip");
  const bar = el("div", "bar");
  for (const spec of BAR) bar.append(keyButton(spec));
  keypadEl.append(stripEl, el("div", "keys"), bar);
  document.getElementById("composer").append(keypadEl);
  renderKeys();
  renderStrip();

  keypadEl.addEventListener("pointerdown", onPointerDown);
  keypadEl.addEventListener("pointermove", onPointerMove);
  keypadEl.addEventListener("pointerup", onPointerUp);
  keypadEl.addEventListener("pointercancel", onPointerCancel);
  // no double-tap zoom, text selection or focus change from the keys; the strip still scrolls
  keypadEl.addEventListener("touchstart", (e) => e.target.closest(".key") && e.preventDefault(), { passive: false });
  keypadEl.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointerdown", closeOnOutside, true);

  // typing with the system keyboard, or moving the caret by tapping, changes the completions
  input.addEventListener("input", renderStrip);
  let caretFrame = 0;
  document.addEventListener("selectionchange", () => {
    if (document.activeElement !== input) return;
    cancelAnimationFrame(caretFrame);
    caretFrame = requestAnimationFrame(renderStrip);
  });
  promptEl.addEventListener("focusout", onEditorBlur);

  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);
  fitViewport();

  setupPanels();
  // tapping the selected item again lets it go (a double tap inserts it, as a double click does)
  tapeEl.addEventListener(
    "click",
    (e) => {
      const item = e.target.closest(".item[data-part]");
      const s = state.selected;
      if (item && s && !state.anchor && e.detail < 2 && Number(item.dataset.id) === s.id && item.dataset.part === s.part) {
        e.stopPropagation();
        select(null);
      }
    },
    true,
  );
  // the welcome screen's examples insert themselves
  emptyEl.addEventListener("click", (e) => {
    const code = e.target.closest(".examples code");
    if (!code) return;
    if (state.mode === "math") textToLatex(code.textContent).then((latex) => latex && insertMath(latex));
    else insertAtCursor(code.textContent);
    edited();
  });
}

// A touch device showing the keyboard layout (?layout=desktop): a way back
function offerKeypad() {
  if (!matchMedia("(hover: none) and (pointer: coarse)").matches) return;
  const b = panelButton("keypad", () => (location.search = "?layout=touch"), "command");
  document.getElementById("commands").append(b);
}

// after app.js (all deferred scripts run before DOMContentLoaded)
document.addEventListener("DOMContentLoaded", () => (TOUCH ? setupTouch() : offerKeypad()));
