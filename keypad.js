// Touch layout: a calculator for phones and tablets without a mouse, laid out like a
// TI-84 with an HP 50g's soft keys. A script in index.html's <head> marks <html
// class="touch"> before anything renders (a touch-only device, or ?layout=touch); without
// it nothing here runs and the page is the keyboard one. touch.css styles all of it.
//
// The page becomes a screen and a keypad. The screen holds a status line (2nd/alpha,
// messages, the soft keys' menu), the tape, the input and, on its bottom edge, the soft
// keys' labels: five of a menu's functions (keys.js), or what can be done with the
// selected result, or completions of the name being typed. Tap a label, or the f1–f5 key
// under it, as on a calculator whose labels are drawn on the screen. Under them, the
// keys of a TI-84: 2nd and alpha print their functions on each key (holding a key is its
// 2nd), the arrows move the caret (◀ ▶) and walk the tape (▲ ▼), ‹› shows the last
// result as a decimal or in degrees, and abc (where the TI has ON) brings up the system
// keyboard.
//
// The keys drive the code the keyboard does. A character key first dispatches a keydown
// on the editor, so app.js's rules apply unchanged (an operator on an empty line
// continues from ans, ⏎ on a selected result inserts it, del deletes it, ← → pan a
// selected graph), and types the character only if app.js left it alone. Function keys
// go through insertKey, as the palette's buttons do, in text and math input alike.

const TOUCH = document.documentElement.classList.contains("touch");
const HOLD_MS = 450; // a long press: the key's 2nd function
const REPEAT_MS = [400, 70]; // del and the arrows held: the first repeat, then every
const SOFT_KEYS = 5; // a menu page, one label above each f-key
const SWIPE_PX = 36; // a sideways drag this long on the soft keys turns the page

const touch = {
  page: savedMenu("touch"), // the menu the soft keys show (keys.js, or vars, test)
  softPage: 0, // and which page of it
  softFor: "", // what the soft keys showed, to start a new context on its first page
  soft: [], // the five soft keys showing
  mod: null, // "2nd", "alpha", "lock" (alpha until pressed again)
  lastKey: null, // the key pressed last (x,t,θ cycles when pressed again)
  varIndex: 0,
  typing: false, // the system keyboard is up (abc)
  press: null, // the key being pressed: {key, spec, id, timer, held, x, y}
  menu: null, // mode's menu
  switching: false, // moving the focus on purpose: not the system keyboard going away
  resetArmed: 0,
  tappedFn: null, // the catalog item tapped once (on a wide screen the first tap shows it)
};
const keySpecs = new WeakMap(); // button -> its key
let keypadEl = null;
let screenEl = null;
let statusEl = null;
let softEl = null;

// --- the keys ----------------------------------------------------------------------
//
// A key is keys.js's (see there), plus: second (what 2nd, or holding the key, does,
// with the legend printed on the key), letter (what alpha types), modifier, repeat.

const op = (label, type, extra = {}) => typed(label, type, { kind: "op", ...extra });
const digit = (d, letter) => typed(d, d, { kind: "digit", letter });
const action = (word, run, tip, extra = {}) => ({ word, action: run, tip, ...extra });

function menuKey(name, letter) {
  const menu = MENUS.find((m) => m.name === name);
  return action(menu?.label ?? name, () => openMenu(name), menu?.tip ?? "Your variables and ans", { kind: "menu", letter });
}

const SECOND = action("2nd", () => setMod(touch.mod === "2nd" ? null : "2nd"), "The function printed above a key: 2nd, then the key (or hold the key)", { kind: "second", modifier: true });
const ALPHA = action("alpha", () => setMod(touch.mod ? null : "alpha"), "The letter printed on a key; 2nd alpha keeps them coming", {
  kind: "alpha",
  modifier: true,
  second: action("A-lock", () => setMod("lock"), "Letters until alpha again"),
});
const VARS = [["x"], ["t"], ["theta", "\\theta"], ["n"]];

// Row by row, five keys each; the arrows take the top two rows' last two columns
const KEYPAD = [
  SECOND,
  action("mode", toggleMenu, "Settings: math input, theme, variables, help, clear", { kind: "menu-key", second: action("help", () => COMMANDS.help.run()) }),
  action("del", backspace, "Delete before the cursor, or the selected entry", { repeat: true, second: action("undo", () => undo(), "Takes back the last delete, clear or forget") }), // app.js

  ALPHA,
  { label: "x,t,\\theta", tex: true, action: cycleVar, cycle: true, tip: "x; press again for t, θ, n" },
  menuKey("stat"),

  menuKey("math", "a"), menuKey("calc", "b"), menuKey("mat", "c"), menuKey("vars"),
  action("clear", clearKey, "Clears the line (or lets go of the selected entry)"),

  typed("x^{n}", "^", { tex: true, letter: "d", tip: "A power: x^2, 2^(1/3); on an empty line, of the last result", second: fn("\\sqrt[n]{x}", "root(|, 3)", "\\sqrt[#?]{#0}", "Root of any degree", { legend: "ⁿ√" }) }),
  word("sin", "sin(|)", "\\sin\\left(#0\\right)", "Angle in radians; add ° (math menu) for degrees", { letter: "e", second: fn("\\sin^{-1}", "asin(|)", "\\arcsin\\left(#0\\right)", "", { legend: "sin⁻¹" }) }),
  word("cos", "cos(|)", "\\cos\\left(#0\\right)", "Angle in radians", { letter: "f", second: fn("\\cos^{-1}", "acos(|)", "\\arccos\\left(#0\\right)", "", { legend: "cos⁻¹" }) }),
  word("tan", "tan(|)", "\\tan\\left(#0\\right)", "Angle in radians", { letter: "g", second: fn("\\tan^{-1}", "atan(|)", "\\arctan\\left(#0\\right)", "", { legend: "tan⁻¹" }) }),
  op("÷", "/", { letter: "h", second: fn("\\pi", "pi", "\\pi", "", { legend: "π" }) }),

  fn("x^2", "^2", "^2", "Squares what's before the cursor (on an empty line, the last result)", { letter: "i", second: fn("\\sqrt{x}", "sqrt(|)", "\\sqrt{#0}", "", { legend: "√" }) }),
  typed(",", ",", { letter: "j", second: fn("EE", "*10^(|)", "\\cdot 10^{#0}", "", { legend: "EE" }) }),
  typed("(", "(", { letter: "k", second: typed("{", "{", { legend: "{" }) }),
  typed(")", ")", { letter: "l", second: typed("}", "}", { legend: "}" }) }),
  op("×", "*", { letter: "m", second: fn("e", "e", "e", "", { legend: "e" }) }),

  word("log", "log(|, 10)", "\\log_{10}\\left(#0\\right)", "Logarithm base 10", { letter: "n", second: fn("10^x", "10^(|)", "10^{#0}", "", { legend: "10ˣ" }) }),
  digit("7", "o"), digit("8", "p"), digit("9", "q"),
  op("−", "-", { letter: "r", second: typed("[", "[", { legend: "[" }) }),

  word("ln", "log(|)", "\\ln\\left(#0\\right)", "Logarithm base e", { letter: "s", second: fn("e^x", "exp(|)", "e^{#0}", "", { legend: "eˣ" }) }),
  digit("4", "t"), digit("5", "u"), digit("6", "v"),
  op("+", "+", { letter: "w", second: typed("]", "]", { legend: "]" }) }),

  typed("=", "=", { letter: "x", tip: "Assigns (a = 3), defines (f(x) = x²) or makes an equation (x² = 4)", second: action("test", () => openMenu("test"), "", { legend: "≤ ≠" }) }),
  digit("1", "y"), digit("2", "z"), digit("3", "θ"),
  action("‹›", cycleView, "The selected or last result as a decimal, in degrees, or exact", { kind: "op", letter: '"' }),

  action("abc", () => setTyping(true), "The system keyboard, for names and Python"),
  { ...digit("0", "␣"), second: action("catalog", () => openCatalog(""), "All the functions") },
  { ...digit(".", ":"), second: fn("i", "I", "i", "", { legend: "i" }) },
  action("(−)", negate, "A minus sign; − subtracts (on an empty line, from the last result)", {
    kind: "digit",
    letter: "?",
    second: typed("ans", "ans", { math: "\\mathrm{ans}", legend: "ans" }),
  }),
  action("enter", enter, "Evaluate; on an empty line, the last one again", { kind: "enter", second: action("entry", recallEntry, "The last line typed, back in the input") }),
];

const ARROWS = [
  { label: "▲", kind: "arrow to-up", repeat: true, action: () => walkTape(-1), tip: "Earlier entries" },
  { label: "▼", kind: "arrow to-down", repeat: true, action: () => walkTape(1) },
  { label: "◀", kind: "arrow to-left", repeat: true, action: () => moveCaret(-1) },
  { label: "▶", kind: "arrow to-right", repeat: true, action: () => moveCaret(1) },
];

// 2nd = : comparisons, as the TI's TEST menu
const TEST = [
  typed("<", "<"), typed(">", ">"), typed("\\le", "<=", { tex: true, math: "\\le" }), typed("\\ge", ">=", { tex: true, math: "\\ge" }),
  typed("\\ne", "!=", { tex: true, math: "\\ne" }), typed("==", "==", { word: "==", tip: "Same expression? True or False" }),
];

// Over the system keyboard (abc): what it hides on its second and third pages
const BAR = [
  action("123", () => setTyping(false), "The keypad again", { kind: "menu" }),
  typed("(", "("), typed(")", ")"), typed("^", "^"), typed("*", "*"), typed("=", "="), typed(",", ","),
];

function label(node, spec) {
  if (spec.word) node.textContent = spec.word;
  else if (spec.tex) tex(node, spec.label, false);
  else node.textContent = spec.label;
}

function keyButton(spec, extraClass = "") {
  const b = el("button", ["key", spec.kind, spec.word && "word", extraClass].filter(Boolean).join(" "));
  b.type = "button";
  b.tabIndex = -1;
  if (spec.second) b.append(el("span", "l2", spec.second.legend ?? spec.second.word));
  if (spec.letter) b.append(el("span", "la", spec.letter === " " ? "␣" : spec.letter));
  const main = el("span", "main");
  label(main, spec);
  b.append(main);
  if (spec.tip) b.setAttribute("aria-label", spec.tip);
  keySpecs.set(b, spec);
  return b;
}

function renderKeys() {
  const frow = el("div", "frow");
  for (let i = 0; i < SOFT_KEYS; i++) frow.append(keyButton(action(`f${i + 1}`, () => pressSoft(i), "The soft key above"), "fkey"));
  const grid = el("div", "ti");
  for (const spec of KEYPAD) grid.append(keyButton(spec));
  const arrows = el("div", "arrows");
  for (const spec of ARROWS) arrows.append(keyButton(spec));
  grid.append(arrows);
  const bar = el("div", "bar");
  for (const spec of BAR) bar.append(keyButton(spec));
  keypadEl.replaceChildren(frow, grid, bar);
}

// --- modifiers -------------------------------------------------------------------------

function setMod(mod) {
  touch.mod = mod;
  const root = document.documentElement.classList;
  root.toggle("mod-2nd", mod === "2nd");
  root.toggle("mod-alpha", mod === "alpha" || mod === "lock");
  renderStatus();
}

// A key let go: its 2nd function after 2nd, its letter after alpha, else what it does
function keyPressed(spec) {
  if (spec.action !== toggleMenu) hideMenu();
  const mod = touch.mod;
  if (mod === "2nd" && spec !== SECOND) {
    setMod(null);
    if (spec.second) return run(spec.second, spec);
  } else if ((mod === "alpha" || mod === "lock") && spec.letter && !spec.modifier) {
    if (mod === "alpha") setMod(null);
    return run({ letter: spec.letter }, spec);
  } else if (mod === "alpha" && !spec.modifier) setMod(null);
  run(spec, spec);
}

function run(spec, key = spec) {
  if (spec.letter && !spec.action && spec.type === undefined && spec.template === undefined) typeLetter(spec.letter);
  else activate(spec);
  touch.lastKey = key;
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

function typeLetter(letter) {
  if (letter === "θ") insertRaw("theta", "\\theta");
  else insertRaw(letter === "␣" ? " " : letter);
  edited();
}

function insertKeyTemplate(spec) {
  if (state.selected) select(null);
  insertKey(spec); // app.js, as the palette does
  edited();
}

// x, then t, θ, n when pressed again right away
function cycleVar() {
  const [prev] = VARS[touch.varIndex];
  const before = state.mode === "text" ? input.value.slice(0, input.selectionStart) : "";
  const again = touch.lastKey?.cycle && (state.mode === "math" || before.endsWith(prev));
  if (again) {
    if (state.mode === "math") mathField.executeCommand("deleteBackward");
    else input.setRangeText("", input.selectionStart - prev.length, input.selectionStart, "end");
    touch.varIndex = (touch.varIndex + 1) % VARS.length;
  } else touch.varIndex = 0;
  const [text, math] = VARS[touch.varIndex];
  insertRaw(text, math);
  edited();
}

function negate() {
  insertRaw("-");
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

function clearKey() {
  if (state.selected) return select(null);
  clearEditor();
  edited();
}

function enter() {
  sendKey("Enter"); // evaluates, or inserts the selected tape item
  edited();
}

// 2nd enter: the last line typed, back in the input to change
function recallEntry() {
  const last = state.entries.findLast((e) => !e.pending);
  if (!last) return;
  clearEditor();
  if (state.mode === "math") textToLatex(last.input).then((latex) => latex && insertMath(latex));
  else insertAtCursor(last.input);
  edited();
}

// ‹›: the selected result, or the last one, shown the next way it can be: exact, as a
// decimal, in degrees
function cycleView() {
  const id = state.selected?.part === "result" ? state.selected.id : state.entries.findLast((e) => e.result)?.id;
  const entry = id && entryById(id);
  if (!entry) return;
  const views = ["exact", ...["float", "degrees"].filter((v) => entry.result[v])];
  if (views.length === 1) return flash("This one has no other form");
  entry.view = views[(views.indexOf(entry.view ?? "exact") + 1) % views.length];
  replaceEntryNode(entry);
}

// --- the soft keys -----------------------------------------------------------------------
//
// What they show, first that applies: what can be done with the selected entry,
// completions of the name being typed, or the menu last opened.

function openMenu(name) {
  if (state.selected) select(null);
  // the menu showing already: its next page
  if (touch.page === name && touch.softFor === `menu:${name}`) return turnPage(1);
  touch.page = name;
  if (MENUS.some((m) => m.name === name)) saveMenu("touch", name);
  touch.softPage = 0;
  renderStrip();
}

function turnPage(delta) {
  const pages = Math.max(1, Math.ceil(softContext().keys.length / SOFT_KEYS));
  touch.softPage = (touch.softPage + delta + pages) % pages;
  renderSoft();
}

function softContext() {
  if (state.selected) {
    const keys = selectionActions() // app.js: the hint line's actions
      .filter((a) => !["Esc", "f", "d"].includes(a.key)) // clear lets go; ‹› has the views
      .map((a) => {
        const text = a.chip ?? a.label;
        const run = a.key === "⌫" ? () => (a.run(), select(null)) : a.run;
        return action(/^[A-Z][^A-Z]*$/.test(text) ? text.toLowerCase() : text, run, "", { danger: a.danger }); // as on a TI: insert, copy, LaTeX
      });
    return { id: `sel:${state.selected.id}:${state.selected.part}`, name: `$${state.selected.id}`, keys };
  }
  const names = completions();
  if (names.length) return { id: "names", name: "names", keys: names.map((s) => action(s.name, () => insertSuggestion(s))) };
  if (touch.page === "vars") return { id: "menu:vars", name: "vars", keys: varsKeys() };
  if (touch.page === "test") return { id: "menu:test", name: "test", keys: TEST };
  const menu = MENUS.find((m) => m.name === touch.page);
  return { id: `menu:${menu.name}`, name: menu.label, keys: menuKeys(menu.name, "touch") };
}

// vars: ans and what's been defined
function varsKeys() {
  const functions = new Set(state.names.functions);
  const names = [{ name: "ans" }, ...state.names.defined.filter((n) => n !== "ans").map((name) => ({ name, fn: functions.has(name) }))];
  return names.map((s) => action(s.fn ? `${s.name}( )` : s.name, () => insertSuggestion(s)));
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
    .slice(0, 20)
    .map((name) => ({ name, fn: functions.has(name), start }));
}

function insertSuggestion(s) {
  if (state.selected) select(null);
  if (state.mode === "math") {
    const name = s.name.length > 1 ? `\\mathrm{${s.name}}` : s.name;
    insertMath(s.fn ? `${name}\\left(#?\\right)` : name);
  } else insertAtCursor(s.fn ? `${s.name}(` : s.name, s.start ?? null);
  edited();
}

function renderSoft() {
  if (!softEl) return;
  const context = softContext();
  if (context.id !== touch.softFor) {
    touch.softFor = context.id;
    touch.softPage = 0;
  }
  const pages = Math.max(1, Math.ceil(context.keys.length / SOFT_KEYS));
  touch.softPage %= pages;
  touch.soft = context.keys.slice(touch.softPage * SOFT_KEYS, (touch.softPage + 1) * SOFT_KEYS);
  const buttons = [];
  for (let i = 0; i < SOFT_KEYS; i++) {
    const spec = touch.soft[i];
    if (!spec) {
      buttons.push(el("span", "sk empty"));
      continue;
    }
    const b = el("button", `key sk${spec.danger ? " danger" : ""}`);
    b.type = "button";
    b.tabIndex = -1;
    label(b, spec);
    if (spec.tip) b.setAttribute("aria-label", spec.tip);
    keySpecs.set(b, spec);
    buttons.push(b);
  }
  softEl.replaceChildren(...buttons);
  statusEl.querySelector(".ind").textContent = `${context.name.toUpperCase()}${pages > 1 ? ` ${touch.softPage + 1}/${pages}` : ""}`;
}

// f1–f5, or a tap on a label: the soft key
function pressSoft(i) {
  const spec = touch.soft[i];
  if (!spec) return;
  if (touch.mod === "2nd" || touch.mod === "alpha") setMod(null);
  activate(spec);
  touch.lastKey = spec;
}

// --- the status line: 2nd/alpha, messages, Stop and Undo ----------------------------------

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
  const badge = { "2nd": "2ND", alpha: "α", lock: "A-LOCK" }[touch.mod];
  if (badge) msg.append(el("span", `badge ${touch.mod === "2nd" ? "second" : "alpha"}`, badge));
  if (state.mode === "math") msg.append(el("span", "badge", "MATH"));
  const text = (html) => {
    const span = el("span", "text");
    span.innerHTML = html.replace(UNDO_HINT, "").replaceAll("⌃M", "mode → Math input"); // app.js
    msg.append(span);
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
}

// Called by app.js's renderHints: on a touch screen the status line and the soft keys say
// what the hint line would
function renderStrip() {
  renderStatus();
  renderSoft();
}

// --- pressing ------------------------------------------------------------------------
//
// Keys act when let go. Held, a key repeats (del, the arrows) or does its 2nd function;
// one with neither says what it does on the status line. One key at a time. A sideways
// drag on the soft keys turns the menu's page.

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
  if (spec.repeat) {
    const repeat = () => {
      press.held = true;
      keyPressed(spec);
      press.timer = setTimeout(repeat, REPEAT_MS[1]);
    };
    press.timer = setTimeout(repeat, REPEAT_MS[0]);
  } else if (!spec.modifier && (spec.second || spec.tip) && !key.classList.contains("sk")) {
    press.timer = setTimeout(() => {
      press.held = true;
      key.classList.remove("down");
      if (spec.second) {
        if (touch.mod === "2nd" || touch.mod === "alpha") setMod(null);
        run(spec.second, spec);
      } else flash(spec.tip);
    }, HOLD_MS);
  }
}

function onPointerMove(e) {
  const press = touch.press;
  if (!press || e.pointerId !== press.id || press.held || !press.key.classList.contains("sk")) return;
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
  if (press.key.classList.contains("sk")) return pressSoft([...softEl.children].indexOf(press.key));
  keyPressed(press.spec);
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
// (iOS doesn't resize the layout for it), so the input and the soft keys stay above it
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv || vv.scale > 1.01) return; // zoomed in: leave the layout alone
  const root = document.documentElement.style;
  root.setProperty("--app-height", `${vv.height}px`);
  root.setProperty("--app-top", `${vv.offsetTop}px`);
}

// --- mode: settings --------------------------------------------------------------------

// classic (the page's own colours) or calculator (graphite, an LCD); index.html's <head>
// applies the saved one before anything renders
function setTheme(theme) {
  document.documentElement.classList.toggle("theme-calc", theme === "calculator");
  try {
    localStorage.setItem("calc.theme", theme);
  } catch {}
}

function toggleMenu() {
  if (touch.menu) return hideMenu();
  const menu = el("div", "touch-menu");
  menu.setAttribute("role", "menu");
  const loaded = (ok) => ok || flash("Python is still loading");
  const item = (text, run) => {
    const b = el("button", "", text);
    b.type = "button";
    b.tabIndex = -1;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => run() === "keep" || hideMenu());
    menu.append(b);
    return b;
  };
  const calc = document.documentElement.classList.contains("theme-calc");
  item(state.mode === "math" ? "Math input: on" : "Math input: off", toggleMode);
  item(calc ? "Theme: calculator" : "Theme: classic", () => setTheme(calc ? "classic" : "calculator"));
  item("Variables", () => loaded(COMMANDS.vars.run()));
  item("Help", () => COMMANDS.help.run());
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

// Taps outside the menu close it
function closeOnOutside(e) {
  if (touch.menu && !touch.menu.contains(e.target) && !e.target.closest?.(".menu-key")) hideMenu();
}

// --- panels, tape, welcome --------------------------------------------------------------

function panelButton(text, onClick, className = "") {
  const b = el("button", className, text);
  b.type = "button";
  b.tabIndex = -1;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
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

  // the screen: status line, tape, preview, input, soft keys
  screenEl = el("div", "screen");
  statusEl = el("div", "status");
  statusEl.append(el("span", "msg"), el("span", "ind"));
  softEl = el("div", "softline");
  screenEl.append(statusEl, tapeEl, previewEl, loadingEl, promptEl, softEl);
  document.querySelector("main").prepend(screenEl);

  keypadEl = el("div");
  keypadEl.id = "keypad";
  document.getElementById("composer").append(keypadEl);
  renderKeys();
  renderStrip();

  for (const root of [keypadEl, softEl]) {
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerCancel);
    // no double-tap zoom, text selection or focus change from the keys
    root.addEventListener("touchstart", (e) => e.target.closest(".key") && e.preventDefault(), { passive: false });
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  document.addEventListener("pointerdown", closeOnOutside, true);

  // typing with the system keyboard, or moving the caret by tapping, changes the completions
  input.addEventListener("input", renderStrip);
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
