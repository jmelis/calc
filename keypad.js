// The calculator: the page is a keypad and its screen, on phones and tablets and on a
// computer alike (where a mouse clicks the keys and a keyboard types). touch.css styles it.
//
// The page is a screen over 40 equal keys, five by eight, laid out so they could be
// built as they are. The screen holds a status line (shift, alpha, messages, what the soft
// keys show), the tape, the input and, on its bottom edge, the soft keys' labels in two
// rows, as on the SwissMicros R47: F1–F5 (the keypad's blank top row) do the lower label,
// shift F1–F5 the upper one. The labels are a soft menu (menus.json: the menu key lists
// the menus, trig has a key of its own), what can be done with the selected result, or
// completions of the name being typed. They're never letters, so completions show while
// typing in alpha, and neither are the arrows. Letters run a on menu, b on trig, c–v five to
// a row, w y z on 0 . ans (x has its own key); a space, quotes and the other characters are
// in the chars menu (shift alpha).
//
// The keys drive the code the keyboard does. A character key first dispatches a keydown
// on the editor, so app.js's rules apply unchanged (an operator on an empty line
// continues from ans, ⏎ on a selected result inserts it, ⌫ deletes it, ← → pan a
// selected graph), and types the character only if app.js left it alone. Function keys
// go through insertKey, in text and math input alike.

const HOLD_MS = 450; // a long press: the key's shift function
const REPEAT_MS = [400, 70]; // ⌫ and the arrows held: the first repeat, then every
const SOFT_KEYS = 5; // one label above each of F1–F5, in each of two rows
const PAGE = 2 * SOFT_KEYS; // a menu's page: the plain row and the shifted one
const SWIPE_PX = 36; // a sideways drag this long on the soft keys turns the page
const SCROLL_PX = 40; // ▲ ▼ on a help page
const PAGE_ROWS = 6; // shift ▲ ▼ in a list

const touch = {
  path: ["top"], // the menus from the top one to the one the soft keys show
  lastPath: null, // where the menu key goes back to from the top
  menuShown: false, // the menu was asked for: it shows instead of completions until the next edit
  softPage: 0, // the page of the soft keys' list
  softFor: "", // what the soft keys showed, to start a new context on its first page
  soft: [], // the ten soft keys showing: F1–F5, then shift F1–F5
  shift: false,
  alpha: null, // "once" (the next key) or "lock" (until alpha again)
  typing: false, // the system keyboard is up (abc)
  press: null, // the key being pressed: {key, spec, id, timer, held, x, y}
  view: null, // the view taking the screen over: {name, index, ...} (VIEWS)
  switching: false, // moving the focus on purpose: not the system keyboard going away
  upperRow: false, // F1–F5 do the upper labels without shift: the row last picked from, until another key
  resetArmed: 0, // until when setup's Reset needs only a second enter
  keyRepeat: false, // a keyboard's key held down, repeating (onKeyboard)
};
const keySpecs = new WeakMap(); // button -> its key
let keypadEl = null;
let screenEl = null;
let statusEl = null;
let viewEl = null;
let softEl = null;

// --- the menus: menus.json -----------------------------------------------------------
//
// {top, menus, keys}: what the menu key shows, the other menus by name, and what the
// names in them insert (menus.json's "about" says how to write them). A name in a menu is
// another menu, a view, or a key; a key needs no entry if it's a function of that name.

let MENUS = null;

async function loadMenus() {
  try {
    const response = await fetch(`menus.json${VERSION}`); // backend.js: the deploy's stamp
    MENUS = await response.json();
  } catch (e) {
    MENUS = { top: [], menus: {}, keys: {} };
    flash(`The menus didn't load: ${e.message}`);
  }
  touch.path = savedPath();
  renderStrip();
}

const isMenu = (name) => name === "top" || !!MENUS?.menus[name];

function menuRows(name) {
  return (name === "top" ? MENUS?.top : MENUS?.menus[name]) ?? [];
}

// The views a menu can open by name (and abc)
const VIEW_ITEMS = {
  vars: () => openView("vars"),
  catalog: () => openView("catalog"),
  help: () => openView("help"),
  setup: () => openView("settings"),
  abc: () => setTyping(true), // the system keyboard, on a phone
};

// A name from a menu, as a soft key
function menuItem(name) {
  if (name === null || name === undefined) return undefined;
  if (isMenu(name)) return action(name, () => openMenu(name, { from: touch.path }), { submenu: true });
  if (VIEW_ITEMS[name]) return action(name, VIEW_ITEMS[name]);
  const def = MENUS.keys[name] ?? {};
  const insert = def.insert ?? `${name}(|)`;
  const spec = { template: insert, math: def.math === undefined ? defaultMath(name, insert) : def.math, method: insert.startsWith(".") };
  if (def.tex) Object.assign(spec, { label: def.tex, tex: true });
  else spec.word = def.label ?? name;
  return spec;
}

// The math input's template for a key that doesn't give one: a function's, or the text
// itself when there's no cursor in it; null (text input only) otherwise
function defaultMath(name, insert) {
  if (insert === `${name}(|)`) return `${KATEX_FUNCS.has(name) ? `\\${name}` : `\\operatorname{${name}}`}\\left(#0\\right)`; // app.js
  if (!insert.includes("|") && !insert.startsWith(".")) return insert;
  return null;
}

// A menu's soft keys, row by row (a short row padded), so the rows stay F1–F5 and shift F1–F5
function menuKeys(name) {
  return menuRows(name).flatMap((row) => Array.from({ length: SOFT_KEYS }, (_, i) => menuItem(row[i])));
}

// The menu path last shown, if menus.json still has its menus
function savedPath() {
  try {
    const path = JSON.parse(localStorage.getItem("calc.menu.touch"));
    if (Array.isArray(path) && path[0] === "top" && path.every(isMenu)) return path;
  } catch {}
  return ["top"];
}

function savePath() {
  try {
    localStorage.setItem("calc.menu.touch", JSON.stringify(touch.path));
  } catch {}
}

// --- the keys ----------------------------------------------------------------------
//
// A key is {label (LaTeX if tex) or word, and what it does: template and math (as in
// menus.json, | and #0 the cursor), type (characters to type), or action}, plus second
// (what shift, or holding the key, does; its legend printed on the key), letter (what
// alpha types), kind (its look), modifier, repeat, nav (what it is to a view: up, down,
// left, right, enter, clear, del, pgup, pgdown) and anywhere (it works while a view shows).

const typed = (label, type, extra = {}) => ({ label, type, ...extra });
const fn = (label, template, math, extra = {}) => ({ label, tex: true, template, math, ...extra });
const word = (text, template, math, extra = {}) => ({ word: text, template, math, ...extra });
const op = (label, type, extra = {}) => typed(label, type, { kind: "op", ...extra });
const digit = (d, letter, extra = {}) => typed(d, d, { kind: "digit", letter, ...extra });
const action = (text, run, extra = {}) => ({ word: text, action: run, ...extra });
const second = (legend, spec) => ({ legend, ...spec });

const softKey = (i) => ({ word: "", kind: "fkey", soft: i, anywhere: true, tip: "The label above it on the screen; with shift, the one above that" });
const SHIFT = action("shift", () => setShift(!touch.shift), { kind: "shift", modifier: true, tip: "The function printed above a key, or the upper soft key label: shift, then the key (or hold the key)" });
const ALPHA = action("alpha", () => setAlpha(touch.alpha === "once" ? "lock" : touch.alpha ? null : "once"), {
  kind: "alpha",
  modifier: true,
  tip: "The letter printed on a key; twice keeps them coming until alpha again",
  second: second("chars", action("chars", () => openMenu("chars"), { anywhere: true })),
});
const X = typed("x", "x", { tex: true, letter: "x", ownLetter: true, second: second("vars", action("vars", () => openView("vars"), { anywhere: true })) });

const KEYPAD = [
  ...[0, 1, 2, 3, 4].map(softKey),

  SHIFT,
  ALPHA,
  { label: "▲", kind: "nav", repeat: true, nav: "up", action: () => walkTape(-1), tip: "Earlier entries", second: second("pg", action("pg", () => turnPage(-1), { nav: "pgup" })) },
  action("menu", menuKey, { kind: "menu", letter: "a", anywhere: true, tip: "The menus; again, back to the one you were in", second: second("catalog", action("catalog", openCatalog, { anywhere: true })) }),
  action("esc", escKey, { kind: "esc", nav: "clear", tip: "Back out: alpha, a view, a selection, or the line", second: second("clear", action("clear", clearTapeKey, { anywhere: true })) }),

  action("trig", () => openMenu("trig"), { kind: "menu", letter: "b", anywhere: true, second: second("hyp", action("hyp", () => openMenu("hyp"), { anywhere: true })) }),
  { label: "◀", kind: "nav", repeat: true, nav: "left", action: () => moveCaret(-1), second: second("⇤", action("⇤", () => caretToEnd(-1), { nav: "home" })) },
  { label: "▼", kind: "nav", repeat: true, nav: "down", action: () => walkTape(1), second: second("pg", action("pg", () => turnPage(1), { nav: "pgdown" })) },
  { label: "▶", kind: "nav", repeat: true, nav: "right", action: () => moveCaret(1), second: second("⇥", action("⇥", () => caretToEnd(1), { nav: "end" })) },
  { label: "⌫", kind: "del", repeat: true, nav: "del", action: backspace, tip: "Delete before the cursor, or the selected entry", second: second("undo", action("undo", () => undo(), { anywhere: true })) }, // app.js

  typed("^", "^", { letter: "c", tip: "A power: x^2, 2^(1/3); on an empty line, of the last result", second: second("√", fn("\\sqrt{x}", "sqrt(|)", "\\sqrt{#0}")) }),
  typed("(", "(", { letter: "d", second: second("[", typed("[", "[")) }),
  typed(")", ")", { letter: "e", second: second("]", typed("]", "]")) }),
  typed(",", ",", { letter: "f", second: second(":", typed(":", ":")) }),
  op("÷", "/", { letter: "g" }),

  word("ln", "log(|)", "\\ln\\left(#0\\right)", { letter: "h", second: second("eˣ", fn("e^x", "exp(|)", "e^{#0}")) }),
  digit("7", "i"),
  digit("8", "j"),
  digit("9", "k"),
  op("×", "*", { letter: "l" }),

  fn("\\pi", "pi", "\\pi", { letter: "m", second: second("i", fn("i", "I", "i")) }),
  digit("4", "n"),
  digit("5", "o"),
  digit("6", "p"),
  op("−", "-", { letter: "q", second: second("(−)", action("(−)", negate)) }),

  typed("=", "=", { letter: "r", tip: "Assigns (a = 3), defines (f(x) = x²) or makes an equation (x² = 4)", second: second("≤≠", action("test", () => openMenu("test"), { anywhere: true })) }),
  digit("1", "s"),
  digit("2", "t"),
  digit("3", "u"),
  op("+", "+", { letter: "v" }),

  X,
  digit("0", "w", { second: second("∞", fn("\\infty", "oo", "\\infty")) }),
  digit(".", "y"),
  typed("ans", "ans", { word: "ans", math: "\\mathrm{ans}", letter: "z", tip: "The last result", second: second("E", fn("E", "E", "\\cdot 10^{#0}")) }),
  action("enter", enter, { kind: "enter", nav: "enter", tip: "Evaluate; on an empty line, the last one again", second: second("≈", action("≈", () => submitApprox())) }), // app.js
];

// Over the system keyboard (abc): what it hides on its second and third pages
const BAR = [
  action("123", () => setTyping(false), { kind: "menu" }),
  typed("(", "("), typed(")", ")"), typed("^", "^"), typed("*", "*"), typed("=", "="), typed(",", ","),
];

function label(node, spec) {
  if (spec.word !== undefined) node.textContent = spec.word;
  else if (spec.tex) tex(node, spec.label, false);
  else node.textContent = spec.label;
}

function keyButton(spec, extraClass = "") {
  const b = el("button", ["key", spec.kind, spec.word && "word", extraClass].filter(Boolean).join(" "));
  b.type = "button";
  b.tabIndex = -1;
  if (spec.second) b.append(el("span", "l2", spec.second.legend));
  if (spec.letter && !spec.ownLetter) b.append(el("span", "la", spec.letter));
  const main = el("span", "main");
  label(main, spec);
  b.append(main);
  if (spec.tip) b.setAttribute("aria-label", spec.tip);
  keySpecs.set(b, spec);
  return b;
}

function renderKeys() {
  const grid = el("div", "grid");
  for (const spec of KEYPAD) grid.append(keyButton(spec));
  const bar = el("div", "bar");
  for (const spec of BAR) bar.append(keyButton(spec));
  keypadEl.replaceChildren(grid, bar);
}

// --- shift and alpha -----------------------------------------------------------------

function setShift(on) {
  touch.shift = on;
  document.documentElement.classList.toggle("mod-shift", on);
  renderStatus();
  renderSoft();
}

function setAlpha(mode) {
  touch.alpha = mode;
  document.documentElement.classList.toggle("mod-alpha", !!mode);
  renderStatus();
}

// A key let go: its letter with alpha (a capital with shift too), its shift function
// with shift, else what it does. mods are the ones on, or the ones a mouse held (clickMod).
function keyPressed(spec, mods = { shift: touch.shift, alpha: touch.alpha }) {
  if (spec.soft !== undefined) return pressSoft(spec.soft, mods.shift || touch.upperRow);
  if (spec.modifier) {
    if (mods.shift && spec.second) {
      setShift(false);
      return run(spec.second);
    }
    return run(spec);
  }
  if (touch.alpha && spec.nav === "clear" && !mods.shift && !touch.view?.locked) return setAlpha(null); // esc: out of alpha first
  if (touch.upperRow && spec.nav === "clear" && !mods.shift) return setUpperRow(false); // then back to F1–F5's own row
  setUpperRow(false); // any other key: the plain labels again
  if (mods.alpha && spec.letter) {
    const letter = mods.shift ? spec.letter.toUpperCase() : spec.letter;
    if (touch.shift) setShift(false);
    if (touch.alpha === "once") setAlpha(null);
    return run({ letter });
  }
  if (touch.alpha === "once") setAlpha(null);
  if (mods.shift) {
    if (touch.shift) setShift(false);
    if (spec.second) return run(spec.second);
  }
  run(spec);
}

// A mouse (the keypad on a computer): shift-click is shift, option-click is alpha
const clickMod = (e) => ({ shift: e.shiftKey || touch.shift, alpha: e.altKey ? "once" : touch.alpha });

// alpha's letter, rather than a key that has one
const isLetter = (spec) => spec.letter && !spec.action && spec.type === undefined && spec.template === undefined;

function run(spec) {
  if (touch.view && !spec.modifier && !spec.anywhere) viewKey(spec);
  else if (isLetter(spec)) typeLetter(spec.letter);
  else activate(spec);
}

function activate(spec) {
  if (spec.action) spec.action();
  else if (spec.template !== undefined) insertKeyTemplate(spec);
  else typeText(spec.type, spec.math);
}

// --- what the keys do --------------------------------------------------------------

// A keydown on the editor, as if typed; true if app.js handled it
function sendKey(key, options = {}, target = editorElement()) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

// After any edit: keep the caret visible, and the preview and the soft keys current
function edited() {
  if (document.activeElement !== editorElement()) focusEditor();
  touch.menuShown = false;
  schedulePreview();
  renderStrip();
}

// Text into the editor as it is, without the keyboard's rules (ans continuation)
function insertRaw(text, math) {
  if (state.selected) select(null);
  if (state.mode === "math") {
    if (math) insertMath(math);
    else mathField.insert(text, { format: "latex", selectionMode: "after" });
  } else input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
}

function typeText(text, math) {
  if (state.selected) select(null);
  if (!(text.length === 1 && sendKey(text))) {
    if (state.mode === "math" && !math) mathField.executeCommand(["typedText", text, { focus: true, simulateKeystroke: true }]);
    else insertRaw(text, math);
  }
  edited();
}

// alpha's letters type as they are (in the tape, f d c would act on a selection)
function typeLetter(letter) {
  insertRaw(letter === "␣" ? " " : letter);
  edited();
}

function insertKeyTemplate(spec) {
  if (state.selected) select(null);
  insertKey(spec); // app.js
  edited();
}

function negate() {
  insertRaw("-");
  edited();
}

// ◀ ▶: the caret; on a selected result, its form (exact, decimal, degrees); on a selected
// graph, a pan (app.js)
function moveCaret(delta) {
  if (state.selected?.part === "result" && !state.anchor) return cycleView(delta);
  if (sendKey(delta < 0 ? "ArrowLeft" : "ArrowRight")) return;
  focusEditor();
  if (state.mode === "math") mathField.executeCommand(delta < 0 ? "moveToPreviousChar" : "moveToNextChar");
  else {
    const { selectionStart: start, selectionEnd: end, value } = input;
    const at = start !== end ? (delta < 0 ? start : end) : Math.max(0, Math.min(value.length, start + delta));
    input.setSelectionRange(at, at);
  }
  renderStrip();
}

// shift ◀ ▶: the start or the end of the line
function caretToEnd(delta) {
  if (state.selected) select(null);
  focusEditor();
  if (state.mode === "math") mathField.executeCommand(delta < 0 ? "moveToMathfieldStart" : "moveToMathfieldEnd");
  else {
    const at = delta < 0 ? 0 : input.value.length;
    input.setSelectionRange(at, at);
  }
  renderStrip();
}

// The forms a result has, in ◀ ▶ order
function resultViews(entry) {
  return ["exact", ...["float", "degrees"].filter((v) => entry?.result?.[v])];
}

function cycleView(delta) {
  const entry = entryById(state.selected.id); // app.js
  const views = resultViews(entry);
  if (views.length < 2) return flash("This one has no other form");
  const at = Math.max(0, views.indexOf(entry.view ?? "exact"));
  entry.view = views[(at + delta + views.length) % views.length];
  replaceEntryNode(entry); // app.js; keeps the selection
}

// ▲ ▼: the keyboard's ↑ ↓, which select earlier entries (enter then inserts one)
function walkTape(delta) {
  sendKey(delta < 0 ? "ArrowUp" : "ArrowDown");
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

// esc backs out one step: a selection, then the line (alpha before either: keyPressed)
function escKey() {
  if (state.selected) return select(null);
  clearEditor();
  edited();
}

// shift esc: the whole tape (shift ⌫ brings it back, as the status line says)
function clearTapeKey() {
  closeView();
  if (state.selected) select(null);
  if (!COMMANDS.clear.run()) flash("Python is still loading"); // app.js
}

function enter() {
  sendKey("Enter"); // evaluates, or inserts the selected tape item
  edited();
}

// --- the soft keys -----------------------------------------------------------------------
//
// What they show, first that applies: the view's own, what can be done with the selected
// entry, completions of the name being typed, or the menu last opened. A page is ten:
// F1–F5, then shift F1–F5; more pages show as dots, and shift ▲ ▼ (or a swipe) turns them.

// The menu key: the menu of menus; from it, back to the menu that was showing; from a menu
// opened in another one, up to that one
function menuKey() {
  const showing = softContext().id.startsWith("menu:");
  if (touch.view) closeView();
  if (state.selected) select(null);
  if (!showing) {
    if (touch.path.length > 1) touch.lastPath = touch.path;
    touch.path = ["top"];
  } else if (touch.path.length > 1) {
    touch.lastPath = touch.path;
    touch.path = touch.path.slice(0, -1);
  } else if (touch.lastPath) touch.path = touch.lastPath;
  touch.menuShown = true;
  savePath();
  renderStrip();
}

// A menu, from its key (trig, shift =) or from another menu's soft key (from: the path to it)
function openMenu(name, { from = null } = {}) {
  if (!MENUS) return;
  if (!isMenu(name)) return flash(`menus.json has no menu called ${name}`);
  if (touch.view) closeView();
  if (state.selected) select(null);
  const path = name === "top" ? ["top"] : from && !from.includes(name) ? [...from, name] : ["top", name];
  const same = touch.menuShown && path.join() === touch.path.join();
  touch.path = path;
  touch.menuShown = true;
  savePath();
  if (same) return turnPage(1); // its key again: the next page, if it has one
  renderStrip();
}

function turnPage(delta) {
  const pages = Math.max(1, Math.ceil(softContext().keys.length / PAGE));
  if (pages === 1) return;
  touch.softPage = (touch.softPage + delta + pages) % pages;
  renderSoft();
}

function softContext() {
  if (touch.view) {
    const def = VIEWS[touch.view.name];
    const id = `view:${touch.view.name}:${def.softId?.(touch.view) ?? ""}`;
    return { id, name: title(touch.view), keys: def.soft?.(touch.view) ?? [] };
  }
  if (state.selected) return { id: `sel:${state.selected.id}:${state.selected.part}`, name: `$${state.selected.id}`, keys: selectionKeys() };
  if (!touch.menuShown) {
    const names = completions();
    if (names.length) return { id: "names", name: "names", keys: names.map((s) => action(s.name, () => insertSuggestion(s))) };
  }
  const name = touch.path.at(-1);
  return { id: `menu:${touch.path.join("/")}`, name: name === "top" ? "menu" : name, keys: menuKeys(name) };
}

// The hint line's actions (app.js) for the selection: the ones it's selected for on F1–F5
// (insert, its forms, copy, delete; a graph's zoom), the rest with shift
function selectionKeys() {
  const primary = ["⏎", "+", "−", "0", "f", "d", "c", "⌫"];
  const actions = selectionActions().filter((a) => a.key !== "Esc"); // esc lets go
  const keys = actions.map((a) => {
    const text = a.chip ?? a.label;
    const run = a.key === "⌫" ? () => (a.run(), select(null)) : a.run;
    return { key: a.key, spec: action(/^[A-Z][^A-Z]*$/.test(text) ? text.toLowerCase() : text, run, { danger: a.danger }) }; // insert, copy, LaTeX
  });
  const lower = keys.filter((k) => primary.includes(k.key)).map((k) => k.spec);
  const upper = [...lower.splice(SOFT_KEYS), ...keys.filter((k) => !primary.includes(k.key)).map((k) => k.spec)];
  return [...Array.from({ length: SOFT_KEYS }, (_, i) => lower[i]), ...upper];
}

// Completions of the name being typed (two letters or more), defined names first
function completions() {
  if (state.mode !== "text") return [];
  const { prefix, start } = wordBeforeCursor();
  if (prefix.length < 2) return [];
  const functions = new Set(state.names.functions);
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
    .slice(0, 2 * PAGE)
    .map((name) => ({ name, fn: functions.has(name), start }));
}

function insertSuggestion(s) {
  if (state.selected) select(null);
  insertName(s.name, s.fn, s.start); // app.js
  edited();
}

function softLabel(spec, i, upper) {
  if (!spec) return el("span", "sk empty");
  const b = el("button", ["key", "sk", spec.danger && "danger", spec.on && "on", spec.submenu && "submenu"].filter(Boolean).join(" "));
  b.type = "button";
  b.tabIndex = -1;
  label(b, spec);
  keySpecs.set(b, { softLabel: i, upper });
  return b;
}

function renderSoft() {
  if (!softEl) return;
  const context = softContext();
  if (context.id !== touch.softFor) {
    touch.softFor = context.id;
    touch.upperRow = false; // another menu (or view, or the completions): its plain row first
    touch.softPage = 0;
  }
  const pages = Math.max(1, Math.ceil(context.keys.length / PAGE));
  touch.softPage %= pages;
  touch.soft = context.keys.slice(touch.softPage * PAGE, (touch.softPage + 1) * PAGE);
  const upper = el("div", "row upper");
  const lower = el("div", "row lower");
  for (let i = 0; i < SOFT_KEYS; i++) {
    lower.append(softLabel(touch.soft[i], i, false));
    upper.append(softLabel(touch.soft[SOFT_KEYS + i], i, true));
  }
  const dots = el("div", "pages");
  if (pages > 1) {
    dots.setAttribute("aria-label", `Page ${touch.softPage + 1} of ${pages}`);
    for (let p = 0; p < pages; p++) dots.append(el("span", p === touch.softPage ? "dot on" : "dot"));
  }
  softEl.replaceChildren(upper, lower, dots);
  softEl.classList.toggle("shifted", touch.shift || touch.upperRow);
  statusEl.querySelector(".ind").textContent = context.name.toUpperCase() + (pages > 1 ? ` ${touch.softPage + 1}/${pages}` : "");
}

// F1–F5 (the upper row with shift, or while it's the row last picked from), or a tap on a
// label. The row picked from stays lit, so the next one comes from it too, until another key
// (or esc, or another menu) brings back the plain row.
function pressSoft(i, upper = touch.shift || touch.upperRow) {
  const spec = touch.soft[(upper ? SOFT_KEYS : 0) + i];
  touch.upperRow = upper && !!spec;
  if (touch.shift) setShift(false);
  if (touch.alpha === "once") setAlpha(null);
  if (spec) activate(spec);
  renderSoft();
}

function setUpperRow(on) {
  if (touch.upperRow === on) return;
  touch.upperRow = on;
  renderSoft();
}

// --- views: setup, vars, the catalog, help --------------------------------------------
//
// As on a TI-84, these take the screen over (the tape and the line wait behind) and the
// keys work them: ▲ ▼ move (shift: a page), enter picks, esc goes back (as does the key
// that opened the view), and the soft keys do the rest. Nothing needs a tap, so they'd work
// on a calculator with only keys; on a phone the lists also scroll, a tap selects a row
// and a tap on the selected one picks it.
//
// A view is {title, hint, render(view, node)} and, as it needs them, open(options) (its
// state), count (rows), pick (enter), key(view, nav) (true if it took the key), type (a
// letter or digit), moved (the selected row changed), tap, soft (its soft keys) and softId
// (when they change), refresh. title and hint can be functions of the view.

const title = (view) => (typeof VIEWS[view.name].title === "function" ? VIEWS[view.name].title(view) : VIEWS[view.name].title);
const viewHint = (view) => (typeof VIEWS[view.name].hint === "function" ? VIEWS[view.name].hint(view) : VIEWS[view.name].hint);

const VIEWS = {
  settings: {
    title: "setup",
    hint: "◀ ▶ change · esc: back",
    count: () => settingsRows().length,
    render(view, node) {
      const list = el("div", "scroll");
      settingsRows().forEach((r, i) => {
        const row = viewRow(view, i, r.danger ? "danger" : "");
        row.append(el("span", "label", r.label));
        if (r.options) {
          const options = el("span", "options");
          for (const o of r.options) options.append(el("span", o === r.value ? "option chosen" : "option", o));
          row.append(options);
        } else row.append(el("span", "go", r.go ?? ""));
        list.append(row);
      });
      node.append(list, about());
    },
    key(view, nav) {
      const r = settingsRows()[view.index];
      if (!r.options || (nav !== "left" && nav !== "right")) return false;
      const i = r.options.indexOf(r.value) + (nav === "left" ? -1 : 1);
      if (i >= 0 && i < r.options.length) choose(r, r.options[i]);
      return true;
    },
    pick(view) {
      const r = settingsRows()[view.index];
      if (r.options) choose(r, r.options[(r.options.indexOf(r.value) + 1) % r.options.length]);
      else r.run();
    },
    // a tap acts at once: it's a menu of commands (Reset still asks twice)
    tap(view, i, target) {
      view.index = i;
      const r = settingsRows()[i];
      const option = target.closest(".option");
      if (r.options && option) choose(r, option.textContent);
      else VIEWS.settings.pick(view);
    },
  },

  vars: {
    title: "vars",
    hint: "esc: back",
    open() {
      memoryState.items = [];
      requestVariables(); // app.js: they arrive in onVars
      return { loading: true };
    },
    count: () => memoryState.items.length,
    render(view, node) {
      const list = el("div", "scroll");
      if (view.loading) list.append(el("div", "note", "Loading…"));
      memoryState.items.forEach((item, i) => {
        const row = viewRow(view, i);
        const math = el("span", "math");
        tex(math, item.latex, false);
        row.append(math, el("span", "kind", item.kind));
        list.append(row);
      });
      if (!view.loading && memoryState.items.length <= 1) list.append(el("div", "note", "Nothing defined yet: a = 3/7 or f(x) = x^2 + 1 define things."));
      node.append(list);
    },
    pick(view) {
      const item = memoryState.items[view.index];
      if (!item) return;
      closeView();
      insertName(item.name, item.kind === "function"); // app.js
      edited();
    },
    key(view, nav) {
      if (nav !== "del") return false;
      if (!repeating()) forgetRow(view); // ⌫ held doesn't forget one after another
      return true;
    },
    soft: (view) => [
      action("insert", () => VIEWS.vars.pick(view)),
      action("forget", () => forgetRow(view), { danger: true }),
      action("undo", () => undo()),
    ],
  },

  // The list (a group of it, or all of it sorted by name; it opens in A-LOCK, so letters
  // jump to a name) and, from it, help pages: an entry in full, its related entries on the soft keys.
  // ▶ goes into a page, ◀ (or esc) back out the way it came; enter inserts from either.
  catalog: {
    title: (view) => (view.pages.length ? "help" : "catalog"),
    hint: (view) => (view.pages.length ? "enter insert · ◀ back" : "letters jump · ▶ help"),
    open({ query = "", replaceFrom = null }) {
      const locked = touch.alpha !== "lock";
      if (locked) setAlpha("lock"); // the letters jump; let go of again on the way out
      const view = { query: "", replaceFrom, group: ALL, items: catalogGroup(ALL), ready: state.ready, pages: [], locked };
      jumpCatalog(view, query); // shift menu, ? or Tab on a name half typed opens it there
      return view;
    },
    count: (view) => (view.pages.length ? 0 : view.items.length),
    render: (view, node) => (view.pages.length ? renderCatalogPage(view, node) : renderCatalogList(view, node)),
    moved(view) {
      if (view.query) {
        jumpCatalog(view, ""); // moving on ends the jump: the next letter starts a new one
        return renderView();
      }
      markRow();
      renderCatalogLine(view);
    },
    type(view, char) {
      if (view.pages.length) return;
      jumpCatalog(view, view.query + (char === "␣" ? " " : char));
      renderView();
    },
    key(view, nav) {
      if (view.pages.length) return catalogPageKey(view, nav);
      if (nav === "right") {
        const entry = view.items[view.index];
        if (entry) showPage(view, entry);
      } else if (nav === "left") closeView();
      else if (nav === "del" && view.query) {
        jumpCatalog(view, view.query.slice(0, -1));
        renderView();
      } else if (nav === "clear" && view.query) {
        jumpCatalog(view, "");
        renderView();
      } else return nav === "del";
      return true;
    },
    pick(view) {
      insertFromCatalogView(view, view.items[view.index]);
    },
    // opened before Python was up: its functions have come since
    refresh(view) {
      if (view.ready === state.ready) return;
      view.ready = state.ready;
      view.items = catalogGroup(view.group);
      view.index = 0;
      jumpCatalog(view, view.query); // what was typed while they loaded jumps now
      renderView();
    },
    softId: (view) => (view.pages.length ? `page:${view.pages.at(-1).name}` : "groups"),
    // the list: its groups; a help page: the related entries, each to its own page
    soft(view) {
      if (view.pages.length) return relatedEntries(view.pages.at(-1)).map((entry) => action(entry.name, () => showPage(view, entry)));
      return catalogGroups().map((group) => action(groupLabel(group), () => showGroup(view, group), { on: group === view.group }));
    },
  },

  help: {
    title: "help",
    hint: "◀ ▶ sections · esc: back",
    open: () => ({ section: 0 }),
    render(view, node) {
      const sections = helpSections();
      const section = sections[view.section];
      const head = el("div", "head");
      head.append(el("span", "", section.querySelector("h2").textContent), el("span", "n", `${view.section + 1}/${sections.length}`));
      const body = el("div", "scroll body");
      if (view.section === 0) body.append(document.querySelector("#help .intro").cloneNode(true));
      for (const child of section.children) if (child.tagName !== "H2") body.append(child.cloneNode(true));
      node.append(head, body);
    },
    key(view, nav) {
      if (scrollKey(nav)) return true;
      if (nav === "left" || nav === "right") showSection(view, view.section + (nav === "left" ? -1 : 1));
      else return false;
      return true;
    },
    soft: (view) => helpSections().map((s, i) => action(s.dataset.tab ?? s.querySelector("h2").textContent, () => showSection(view, i), { on: i === view.section })),
  },
};

function openView(name, options = {}) {
  if (touch.view?.name === name && !options.query) return closeView(); // its key again: back
  closeView();
  if (state.selected) select(null);
  if (touch.typing) setTyping(false);
  if (touch.alpha) setAlpha(null);
  touch.view = { name, index: 0, ...VIEWS[name].open?.(options) };
  // over everything between the status line and the soft keys
  viewEl.style.top = `${statusEl.offsetHeight}px`;
  viewEl.style.bottom = `${softEl.offsetHeight}px`;
  viewEl.hidden = false;
  renderView();
  renderStrip();
  return true;
}

function closeView() {
  const view = touch.view;
  if (!view) return true;
  touch.view = null;
  if (view.locked && touch.alpha === "lock") setAlpha(null);
  viewEl.hidden = true;
  viewEl.replaceChildren();
  renderStrip();
  return true;
}

function renderView() {
  const view = touch.view;
  viewEl.className = `view ${view.name}${view.pages?.length ? " page" : ""}`;
  viewEl.replaceChildren();
  VIEWS[view.name].render(view, viewEl);
  markRow();
}

// A key while a view shows (one that opens a menu or a view, the modifiers and undo don't
// come here): the view's if it takes it; ▲ ▼ move, enter picks and esc goes back if it
// doesn't; anything else would type into the line behind, and does nothing
function viewKey(spec) {
  const view = touch.view;
  const def = VIEWS[view.name];
  const char = isLetter(spec) ? spec.letter : spec.kind === "digit" ? spec.type : undefined;
  if (spec.nav && !def.key?.(view, spec.nav)) {
    if (spec.nav === "up" || spec.nav === "down") moveRow(spec.nav === "up" ? -1 : 1);
    else if (spec.nav === "pgup" || spec.nav === "pgdown") moveRow(spec.nav === "pgup" ? -PAGE_ROWS : PAGE_ROWS, false);
    else if (spec.nav === "enter") def.pick?.(view);
    else if (spec.nav === "clear") closeView();
  } else if (char !== undefined) def.type?.(view, char);
  if (touch.view) renderStrip(); // the hint and the soft keys can change with the row or page
}

// ▲ ▼ (shift: a page) on a view that scrolls rather than moves a row
function scrollKey(nav) {
  const body = viewEl.querySelector(".scroll");
  const step = { up: -SCROLL_PX, down: SCROLL_PX, pgup: -body?.clientHeight, pgdown: body?.clientHeight }[nav];
  if (step === undefined || !body) return false;
  body.scrollTop += step;
  return true;
}

// A key held down, repeating: the keypad's or a keyboard's
const repeating = () => touch.press?.held || touch.keyRepeat;

// A keyboard (a computer's, or a device whose keys arrive as key events) types into the
// line (app.js's keydown handling). While a view shows, the line is behind it,
// so the keys work the view as the keypad's do: the arrows, ⏎ (enter), Esc, ⌫, Page Up/Down,
// letters and digits (the catalog's jump) and ⌃Z (undo).
const KEYBOARD_NAV = {
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "enter", Escape: "clear",
  Backspace: "del", Delete: "del", PageUp: "pgup", PageDown: "pgdown",
};

function onKeyboard(e) {
  if (!touch.view || e.metaKey || e.altKey || e.isComposing) return;
  const nav = KEYBOARD_NAV[e.key];
  if (e.ctrlKey) {
    if (e.key !== "z") return;
    undo();
  } else if (nav) {
    touch.keyRepeat = e.repeat;
    viewKey({ nav });
    touch.keyRepeat = false;
  } else if (e.key.length === 1) viewKey({ letter: e.key });
  else if (e.key !== "Tab") return; // Tab would take the focus from the line
  e.preventDefault();
  e.stopPropagation();
}

function viewRow(view, i, className = "") {
  const row = el("div", ["row", i === view.index && "on", className].filter(Boolean).join(" "));
  row.dataset.i = i;
  return row;
}

// The selected row marked, and scrolled to
function markRow() {
  viewEl.querySelector(".row.on")?.classList.remove("on");
  const row = viewEl.querySelector(`.row[data-i="${touch.view.index}"]`);
  if (!row) return;
  row.classList.add("on");
  const scroller = row.closest(".scroll");
  const box = scroller.getBoundingClientRect();
  const above = box.top - row.getBoundingClientRect().top;
  const below = row.getBoundingClientRect().bottom - box.bottom;
  if (above > 0) scroller.scrollTop -= above;
  else if (below > 0) scroller.scrollTop += below;
}

// ▲ ▼: the next row, round from the last to the first, as a TI's menus do; a page at a
// time (shift) stops at the ends
function moveRow(delta, round = true) {
  const view = touch.view;
  const def = VIEWS[view.name];
  const n = def.count?.(view) ?? 0;
  if (!n) return;
  view.index = round ? (view.index + delta + n) % n : Math.max(0, Math.min(n - 1, view.index + delta));
  if (def.moved) def.moved(view);
  else markRow();
}

// A tap: selects a row; on the selected one, picks it
function onViewTap(e) {
  const view = touch.view;
  const row = e.target.closest?.(".row[data-i]");
  if (!view || !row) return;
  const i = Number(row.dataset.i);
  const def = VIEWS[view.name];
  if (def.tap) def.tap(view, i, e.target);
  else if (i === view.index) def.pick?.(view);
  else {
    view.index = i;
    if (def.moved) def.moved(view);
    else markRow();
  }
  renderStrip();
}

// setup: a choice (◀ ▶ or enter changes it) or a command (enter)
function settingsRows() {
  const armed = Date.now() < touch.resetArmed;
  return [
    { label: "Input", options: ["text", "math"], value: state.mode, set: (mode) => setMode(mode).then(() => touch.view?.name === "settings" && renderView()) },
    { label: "Variables", go: "shift x", run: () => openView("vars") },
    { label: "Catalog", go: "shift menu", run: openCatalog },
    { label: "Help", go: "menu", run: () => openView("help") },
    { label: "Clear the tape", go: "shift esc", run: () => COMMANDS.clear.run() && closeView() },
    { label: armed ? "Reset: once more to forget all variables too" : "Reset…", danger: armed, run: reset },
  ];
}

function choose(row, value) {
  if (value !== row.value) row.set(value);
  renderView();
}

// Reset forgets everything, so it asks for a second enter (or tap)
function reset() {
  if (Date.now() > touch.resetArmed) {
    touch.resetArmed = Date.now() + 4000;
    setTimeout(() => touch.view?.name === "settings" && renderView(), 4100);
    return renderView();
  }
  touch.resetArmed = 0;
  COMMANDS.reset.run();
  closeView();
}

// The version and the source, under setup: the deploy's commit (its ?v= stamp, backend.js's
// VERSION) linked to it on GitHub; running locally there's no stamp, and it says "local"
function about() {
  const line = el("div", "about");
  const sha = new URLSearchParams(VERSION).get("v");
  const version = sha ? el("a", "", sha.slice(0, 7)) : el("span", "", "local");
  if (sha) Object.assign(version, { href: `https://github.com/jmelis/calc/commit/${sha}`, target: "_blank", rel: "noopener" });
  const source = Object.assign(el("a", "", "source"), { href: "https://github.com/jmelis/calc", target: "_blank", rel: "noopener" });
  line.append("Version ", version, " · ", source);
  return line;
}

// vars: the list comes again after :vars, a forget or its undo (app.js's onVariables)
function onVars(error) {
  const view = touch.view;
  if (view?.name !== "vars") return;
  view.loading = false;
  view.index = Math.min(view.index, Math.max(0, memoryState.items.length - 1));
  renderView();
  if (error) flash(error);
}

function forgetRow(view) {
  const item = memoryState.items[view.index];
  if (!item) return;
  if (item.name === "ans") return flash("ans is the last result: it can't be forgotten");
  forgetVariable(item.name); // app.js; the list comes back without it
}

// shift menu: the catalog, at the name half typed before the cursor if there's one
function openCatalog() {
  const { prefix, start } = state.mode === "text" ? wordBeforeCursor() : { prefix: "" }; // app.js
  return openView("catalog", prefix ? { query: prefix, replaceFrom: start } : {});
}

function insertFromCatalogView(view, entry) {
  if (!entry) return;
  closeView();
  insertCatalogEntry(entry, view.replaceFrom); // app.js
  edited();
}

// catalog: the list. Its group (or the letters being jumped to), the entries, and the
// selected one's signature and summary
function renderCatalogList(view, node) {
  const head = el("div", "search");
  if (view.query) head.append(el("span", `query${view.miss ? " miss" : ""}`, view.query), el("span", "cursor"));
  else if (!view.ready) head.append(el("span", "placeholder", "Python is loading the functions…"));
  else head.append(el("span", "group", groupLabel(view.group)));
  if (view.items.length) head.append(el("span", "n", `${view.index + 1}/${view.items.length}`));
  node.append(head);
  const list = el("div", "scroll");
  view.items.forEach((e, i) => {
    const row = viewRow(view, i);
    row.append(el("span", "name", e.name));
    if (view.group === ALL) row.append(el("span", "kind", groupLabel(e.category)));
    list.append(row);
  });
  if (!view.items.length && view.ready) list.append(el("div", "note", "Nothing here"));
  node.append(list, el("div", "line"));
  renderCatalogLine(view);
}

function renderCatalogLine(view) {
  const line = viewEl.querySelector(".line");
  const entry = view.items[view.index];
  line?.replaceChildren(...(entry ? [el("div", "sig", entry.signature || entry.name), el("div", "summary", entry.summary)] : []));
  const n = viewEl.querySelector(".search .n");
  if (n) n.textContent = `${view.index + 1}/${view.items.length}`;
}

// catalog: a help page, the entry in full (app.js renders it, the example typeset); its
// related entries are on the soft keys
function renderCatalogPage(view, node) {
  const entry = view.pages.at(-1);
  const body = el("div", "scroll body info");
  renderCatalogEntry(body, entry, (name) => showPage(view, catalogEntries().find((e) => e.name === name))); // app.js
  node.append(body);
}

function catalogPageKey(view, nav) {
  if (scrollKey(nav)) return true;
  if (nav === "left" || nav === "clear" || nav === "del") {
    if (!repeating()) view.pages.pop();
    renderView();
  } else if (nav === "enter") insertFromCatalogView(view, view.pages.at(-1));
  return true;
}

function showPage(view, entry) {
  view.pages.push(entry);
  renderView();
  renderStrip();
}

// An entry's see-also (catalog.py), as entries; your own definitions have none
function relatedEntries(entry) {
  const all = catalogEntries(); // app.js
  return (entry.see ?? []).map((name) => all.find((e) => e.name === name)).filter(Boolean);
}

// The catalog's groups, on the soft keys and under ◀ ▶: all of it, sorted by name, then
// catalog.py's categories (and your own definitions), with a short name each
const ALL = "all";
const GROUP_LABELS = {
  "Your definitions": "yours",
  Calculator: "basics",
  "Linear algebra": "linalg",
  Functions: "funcs",
  Statistics: "stats",
  Plotting: "plots",
};
const groupLabel = (group) => GROUP_LABELS[group] ?? group.toLowerCase();

function catalogGroups() {
  const groups = [ALL];
  for (const e of catalogEntries()) if (!groups.includes(e.category)) groups.push(e.category); // app.js
  return groups;
}

function catalogGroup(group) {
  const all = catalogEntries(); // app.js: your definitions, then catalog.py's
  if (group !== ALL) return all.filter((e) => e.category === group);
  return [...all].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function showGroup(view, group) {
  view.group = group;
  view.items = catalogGroup(group);
  view.index = 0;
  view.query = "";
  view.miss = false;
  renderView();
  renderStrip();
}

// Letters jump, as a TI's catalog does: to the first name that starts with what's typed
// (then to one that has it in), in this group or, failing that, in all of it
function jumpCatalog(view, query) {
  view.query = query;
  view.miss = false;
  const q = query.trim().toLowerCase();
  if (!q) return;
  let at = findEntry(view.items, q);
  if (at < 0 && view.group !== ALL) {
    const all = catalogGroup(ALL);
    at = findEntry(all, q);
    if (at >= 0) {
      view.group = ALL;
      view.items = all;
    }
  }
  if (at < 0) view.miss = true; // nothing of that name: the line says so, ⌫ takes it back
  else view.index = at;
}

function findEntry(items, q) {
  const starts = items.findIndex((e) => e.name.toLowerCase().startsWith(q));
  return starts >= 0 ? starts : items.findIndex((e) => e.name.toLowerCase().includes(q));
}

// help: the Help panel's sections (index.html), one at a time; their tabs are the soft keys
function helpSections() {
  return [...document.querySelectorAll("#help > section")];
}

function showSection(view, i) {
  const n = helpSections().length;
  view.section = (i + n) % n;
  renderView();
  renderStrip();
}

// --- the status line: shift/alpha, messages, Stop and Undo ----------------------------------

function statusLink(text, onClick) {
  const b = el("button", "link", text);
  b.type = "button";
  b.tabIndex = -1;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

function renderStatus() {
  if (!statusEl) return;
  const msg = statusEl.querySelector(".msg");
  msg.replaceChildren();
  if (touch.shift) msg.append(el("span", "badge second", "SHIFT"));
  if (touch.alpha) msg.append(el("span", "badge alpha", touch.alpha === "lock" ? "A-LOCK" : "α"));
  if (state.mode === "math") msg.append(el("span", "badge", "MATH"));
  let said = false;
  const text = (html) => {
    const span = el("span", "text");
    span.innerHTML = html.replace(UNDO_HINT, "").replaceAll("⌃M", "setup → Input"); // app.js
    msg.append(span);
    said = true;
  };
  if (state.status) text(state.status);
  else if (busy()) {
    text("computing…");
    msg.append(statusLink("stop", () => send({ type: "interrupt" })));
  }
  if (state.flash) {
    text(state.flash);
    if (UNDO_HINT.test(state.flash)) msg.append(statusLink("undo", undo));
  }
  if (!said) msg.append(statusHint());
}

// Nothing else to say: how to work a view, a selected result's forms, or (nothing on the
// tape yet) where the menus are
function statusHint() {
  const hint = el("span", "hint");
  const entry = state.selected?.part === "result" && !state.anchor && entryById(state.selected.id);
  if (touch.view) hint.textContent = viewHint(touch.view);
  else if (entry && resultViews(entry).length > 1) {
    const names = { exact: "exact", float: "decimal", degrees: "degrees" };
    hint.append("◀ ▶ ");
    resultViews(entry).forEach((v, i) => {
      if (i) hint.append(" · ");
      hint.append(v === (entry.view ?? "exact") ? el("b", "", names[v]) : names[v]);
    });
  } else if (!state.entries.length) hint.textContent = "menu: the menus, and help";
  return hint;
}

// The status line and the soft keys, as things change (app.js's renderHints calls it too)
function renderStrip() {
  if (touch.view) VIEWS[touch.view.name].refresh?.(touch.view);
  renderStatus();
  renderSoft();
}

// --- pressing ------------------------------------------------------------------------
//
// Keys act when let go. Held, a key repeats (⌫, the arrows) or does its shift function
// (a soft key, its upper label); one with neither says what it does on the status line.
// One key at a time. A sideways drag on the soft keys' labels turns the page. With a
// mouse, shift-click is shift and option-click alpha (`clickMod`).

function onPointerDown(e) {
  const key = e.target.closest?.(".key");
  if (!key || !keySpecs.has(key)) return;
  e.preventDefault(); // keep the focus in the input
  if (touch.press) return;
  const spec = keySpecs.get(key);
  key.setPointerCapture?.(e.pointerId);
  key.classList.add("down");
  const press = { key, spec, id: e.pointerId, held: false, timer: null, x: e.clientX, y: e.clientY };
  touch.press = press;
  const hold = (then) => {
    press.timer = setTimeout(() => {
      press.held = true;
      key.classList.remove("down");
      then();
    }, HOLD_MS);
  };
  if (spec.repeat) {
    const repeat = () => {
      press.held = true;
      keyPressed(spec);
      press.timer = setTimeout(repeat, REPEAT_MS[1]);
    };
    press.timer = setTimeout(repeat, REPEAT_MS[0]);
  } else if (spec.soft !== undefined) hold(() => pressSoft(spec.soft, true));
  else if (!spec.modifier && spec.softLabel === undefined && (spec.second || spec.tip)) {
    hold(() => {
      if (!spec.second) return flash(spec.tip);
      setUpperRow(false);
      if (touch.shift) setShift(false);
      if (touch.alpha === "once") setAlpha(null);
      run(spec.second);
    });
  }
}

function onPointerMove(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id || press.held || press.spec.softLabel === undefined) return;
  const dx = e.clientX - press.x;
  if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(e.clientY - press.y)) {
    clearTimeout(press.timer);
    press.key.classList.remove("down");
    touch.press = null;
    turnPage(dx < 0 ? 1 : -1);
  }
}

function onPointerUp(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id) return;
  touch.press = null;
  clearTimeout(press.timer);
  press.key.classList.remove("down");
  if (press.held) return;
  if (press.spec.softLabel !== undefined) return pressSoft(press.spec.softLabel, press.spec.upper);
  keyPressed(press.spec, clickMod(e));
}

function onPointerCancel(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id) return;
  touch.press = null;
  clearTimeout(press.timer);
  press.key.classList.remove("down");
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

// The system keyboard was put away: back to the keypad
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
// (iOS doesn't resize the layout for it), so the input and the soft keys stay above it
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv || vv.scale > 1.01) return; // zoomed in: leave the layout alone
  const root = document.documentElement.style;
  root.setProperty("--app-height", `${vv.height}px`);
  root.setProperty("--app-top", `${vv.offsetTop}px`);
}

// --- setup -----------------------------------------------------------------------------

function setupKeypad() {
  input.inputMode = "none";
  input.enterKeyHint = "go";

  // the screen: status line, tape, preview, input, soft keys, and the view over them
  screenEl = el("div", "screen");
  statusEl = el("div", "status");
  statusEl.append(el("span", "msg"), el("span", "ind"));
  softEl = el("div", "softline");
  viewEl = el("div", "view");
  viewEl.hidden = true;
  screenEl.append(statusEl, tapeEl, previewEl, loadingEl, promptEl, viewEl, softEl);
  document.querySelector("main").prepend(screenEl);

  // the catalog, :vars and :help (app.js's popups) are views here
  panels.catalog = (query = "", replaceFrom = null) => openView("catalog", { query, replaceFrom });
  panels.vars = () => openView("vars");
  panels.help = () => openView("help");
  panels.varsChanged = onVars;

  keypadEl = el("div");
  keypadEl.id = "keypad";
  document.getElementById("composer").append(keypadEl);
  renderKeys();
  renderStrip();
  loadMenus();

  for (const root of [keypadEl, softEl]) {
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerCancel);
    // no double-tap zoom, text selection or focus change from the keys
    root.addEventListener("touchstart", (e) => e.target.closest(".key") && e.preventDefault(), { passive: false });
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  viewEl.addEventListener("mousedown", (e) => e.target.closest("a") || e.preventDefault()); // keep the focus in the input
  viewEl.addEventListener("click", onViewTap);
  document.addEventListener("keydown", onKeyboard, true); // before the line (and MathLive) sees it

  // typing with the system keyboard, or moving the caret by tapping, changes the completions
  input.addEventListener("input", () => {
    touch.menuShown = false;
    renderStrip();
  });
  let caretFrame = 0;
  document.addEventListener("selectionchange", () => {
    if (document.activeElement !== input) return;
    cancelAnimationFrame(caretFrame);
    caretFrame = requestAnimationFrame(renderSoft);
  });
  promptEl.addEventListener("focusout", onEditorBlur);

  window.visualViewport?.addEventListener("resize", fitViewport);
  window.visualViewport?.addEventListener("scroll", fitViewport);
  fitViewport();

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
}

// after app.js (all deferred scripts run before DOMContentLoaded)
document.addEventListener("DOMContentLoaded", setupKeypad);
