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
// result as a decimal (2nd ‹› in degrees), and abc (where the TI has ON) brings up the
// system keyboard. settings, vars, the catalog and help are views that take the screen
// over, worked with the same keys (see "views" below).
//
// The keys drive the code the keyboard does. A character key first dispatches a keydown
// on the editor, so app.js's rules apply unchanged (an operator on an empty line
// continues from ans, ⏎ on a selected result inserts it, ⌫ deletes it, ← → pan a
// selected graph), and types the character only if app.js left it alone. Function keys
// go through insertKey, as the palette's buttons do, in text and math input alike.

const TOUCH = document.documentElement.classList.contains("touch");
const HOLD_MS = 450; // a long press: the key's 2nd function
const REPEAT_MS = [400, 70]; // ⌫ and the arrows held: the first repeat, then every
const SOFT_KEYS = 5; // a menu page, one label above each f-key
const SWIPE_PX = 36; // a sideways drag this long on the soft keys turns the page
const SCROLL_PX = 40; // ▲ ▼ in help

const touch = {
  page: savedMenu("touch"), // the menu the soft keys show (keys.js's, or test)
  softPage: 0, // and which page of it
  softFor: "", // what the soft keys showed, to start a new context on its first page
  soft: [], // the five soft keys showing
  mod: null, // "2nd", "alpha", "lock" (alpha until pressed again)
  typing: false, // the system keyboard is up (abc)
  press: null, // the key being pressed: {key, spec, id, timer, held, x, y}
  view: null, // the view taking the screen over: {name, index, ...} (VIEWS)
  switching: false, // moving the focus on purpose: not the system keyboard going away
  resetArmed: 0, // until when settings' Reset needs only a second enter
};
const keySpecs = new WeakMap(); // button -> its key
let keypadEl = null;
let screenEl = null;
let statusEl = null;
let viewEl = null;
let softEl = null;

// --- the keys ----------------------------------------------------------------------
//
// A key is keys.js's (see there), plus: second (what 2nd, or holding the key, does,
// with the legend printed on the key), letter (what alpha types), modifier, repeat, nav
// (what it is to a view: up, down, left, right, enter, clear, del) and anywhere (it works
// while a view shows: it opens a menu or a view, or undoes).

const op = (label, type, extra = {}) => typed(label, type, { kind: "op", ...extra });
const digit = (d, letter) => typed(d, d, { kind: "digit", letter });
const action = (word, run, tip, extra = {}) => ({ word, action: run, tip, ...extra });

function menuKey(name, letter) {
  const menu = MENUS.find((m) => m.name === name);
  return action(menu?.label ?? name, () => openMenu(name), menu?.tip ?? "", { kind: "menu", letter, anywhere: true });
}

const SECOND = action("2nd", () => setMod(touch.mod === "2nd" ? null : "2nd"), "The function printed above a key: 2nd, then the key (or hold the key)", { kind: "second", modifier: true });
const ALPHA = action("alpha", () => setMod(touch.mod ? null : "alpha"), "The letter printed on a key; 2nd alpha keeps them coming", {
  kind: "alpha",
  modifier: true,
  second: action("A-lock", () => setMod("lock"), "Letters until alpha again", { anywhere: true }),
});

// Row by row, five keys each; the arrows take the middle of the top two rows
const KEYPAD = [
  SECOND,
  action("settings", () => openView("settings"), "Math input, the theme, clearing the tape…", { anywhere: true, second: action("help", () => openView("help"), "", { anywhere: true }) }),
  menuKey("stat"),
  action("catalog", () => openView("catalog"), "All the functions: search, see an example, insert", { kind: "menu", anywhere: true }),

  ALPHA,
  typed("x", "x", { tex: true, tip: "The variable x" }),
  fn("x^{-1}", "^-1", "^{-1}", "One over what's before the cursor (on an empty line, the last result)"),
  action("clear", clearKey, "Clears the line (or lets go of the selected entry)", { nav: "clear" }),

  menuKey("math", "a"), menuKey("calc", "b"), menuKey("mat", "c"),
  action("vars", () => openView("vars"), "Your variables: insert one, or forget it", { kind: "menu", anywhere: true }),
  { label: "⌫", action: backspace, tip: "Delete before the cursor, or the selected entry", kind: "del", repeat: true, nav: "del", second: action("undo", () => undo(), "Takes back the last delete, clear or forget", { anywhere: true }) }, // app.js

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

  typed("=", "=", { letter: "x", tip: "Assigns (a = 3), defines (f(x) = x²) or makes an equation (x² = 4)", second: action("test", () => openMenu("test"), "", { legend: "≤ ≠", anywhere: true }) }),
  digit("1", "y"), digit("2", "z"), digit("3", "θ"),
  action("‹›", () => showAs("float"), "The selected or last result as a decimal, or exact again", { kind: "op", letter: '"', second: action("°", () => showAs("degrees"), "", { legend: "→°" }) }),

  action("abc", () => setTyping(true), "The system keyboard, for names and Python"),
  { ...digit("0", "␣"), second: action("catalog", () => openView("catalog"), "All the functions", { anywhere: true }) },
  { ...digit(".", ":"), second: fn("i", "I", "i", "", { legend: "i" }) },
  action("(−)", negate, "A minus sign; − subtracts (on an empty line, from the last result)", {
    kind: "digit",
    letter: "?",
    second: typed("ans", "ans", { math: "\\mathrm{ans}", legend: "ans" }),
  }),
  action("enter", enter, "Evaluate; on an empty line, the last one again", { kind: "enter", nav: "enter", second: action("entry", recallEntry, "The last line typed, back in the input") }),
];

const ARROWS = [
  { label: "▲", kind: "arrow to-up", repeat: true, nav: "up", action: () => walkTape(-1), tip: "Earlier entries" },
  { label: "▼", kind: "arrow to-down", repeat: true, nav: "down", action: () => walkTape(1) },
  { label: "◀", kind: "arrow to-left", repeat: true, nav: "left", action: () => moveCaret(-1) },
  { label: "▶", kind: "arrow to-right", repeat: true, nav: "right", action: () => moveCaret(1) },
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
  for (let i = 0; i < SOFT_KEYS; i++) frow.append(keyButton(action(`f${i + 1}`, () => pressSoft(i), "The soft key above", { anywhere: true }), "fkey"));
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
  const mod = touch.mod;
  if (mod === "2nd" && spec !== SECOND) {
    setMod(null);
    if (spec.second) return run(spec.second);
  } else if ((mod === "alpha" || mod === "lock") && spec.letter && !spec.modifier) {
    if (mod === "alpha") setMod(null);
    return run({ letter: spec.letter });
  } else if (mod === "alpha" && !spec.modifier) setMod(null);
  run(spec);
}

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

// alpha's letters type as they are (in the tape, f d c would act on a selection), but ? goes
// to app.js first: on an empty line it opens the catalog, as on the keyboard
function typeLetter(letter) {
  if (letter === "?" && sendKey("?")) return;
  if (letter === "θ") insertRaw("theta", "\\theta");
  else insertRaw(letter === "␣" ? " " : letter);
  edited();
}

function insertKeyTemplate(spec) {
  if (state.selected) select(null);
  insertKey(spec); // app.js, as the palette does
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

// ‹› (float) and 2nd ‹› (degrees): the selected result, or the last one, shown that way,
// or exact again
function showAs(view) {
  const id = state.selected?.part === "result" ? state.selected.id : state.entries.findLast((e) => e.result)?.id;
  const entry = id && entryById(id);
  if (!entry) return;
  if (!entry.result[view] && entry.view !== view) {
    return flash(view === "float" ? "This one has no other decimal form" : "Only a real number has a degrees view");
  }
  entry.view = entry.view === view ? "exact" : view;
  replaceEntryNode(entry);
}

// --- the soft keys -----------------------------------------------------------------------
//
// What they show, first that applies: the view's own, what can be done with the selected
// entry, completions of the name being typed, or the menu last opened. Under them, when a
// menu has more than five, arrows and a dot for each page.

function openMenu(name) {
  if (touch.view) closeView();
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
  if (touch.view) {
    const def = VIEWS[touch.view.name];
    return { id: `view:${touch.view.name}`, name: def.title, keys: def.soft?.(touch.view) ?? [] };
  }
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
  if (touch.page === "test") return { id: "menu:test", name: "test", keys: TEST };
  const menu = MENUS.find((m) => m.name === touch.page);
  return { id: `menu:${menu.name}`, name: menu.label, keys: menuKeys(menu.name, "touch") };
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
  insertName(s.name, s.fn, s.start); // app.js
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
    const b = el("button", `key sk${spec.danger ? " danger" : ""}${spec.on ? " on" : ""}`);
    b.type = "button";
    b.tabIndex = -1;
    label(b, spec);
    if (spec.tip) b.setAttribute("aria-label", spec.tip);
    keySpecs.set(b, spec);
    buttons.push(b);
  }
  const dots = el("div", "pages");
  if (pages > 1) {
    dots.setAttribute("aria-label", `Page ${touch.softPage + 1} of ${pages}`);
    dots.append(el("span", "turn back", "◂"));
    for (let p = 0; p < pages; p++) dots.append(el("span", p === touch.softPage ? "dot on" : "dot"));
    dots.append(el("span", "turn on", "▸"));
  }
  softEl.replaceChildren(...buttons, dots);
  statusEl.querySelector(".ind").textContent = context.name.toUpperCase();
}

// f1–f5, or a tap on a label: the soft key
function pressSoft(i) {
  const spec = touch.soft[i];
  if (!spec) return;
  if (touch.mod === "2nd" || touch.mod === "alpha") setMod(null);
  activate(spec);
}

// --- views: settings, vars, the catalog, help --------------------------------------------
//
// As on a TI-84, these take the screen over (the tape and the line wait behind) and the
// keys work them: ▲ ▼ move, ◀ ▶ change the group (catalog, help) or the setting, enter
// picks, clear goes back (as does the key that opened the view), and the soft keys do the
// rest. The catalog opens in A-LOCK: the letters on the keys search it. Nothing needs a
// tap, so they'd work on a calculator with only keys; on a phone the lists also scroll, a
// tap selects a row and a tap on the selected one picks it.
//
// A view is {title, hint, render(view, node)} and, as it needs them, open(options) (its
// state), count (rows), pick (enter), key(view, nav) (true if it took the key), type (a
// letter or digit), moved (the selected row changed), tap, soft (its soft keys), refresh.

const VIEWS = {
  settings: {
    title: "settings",
    hint: "◀ ▶ change · clear: back",
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
    hint: "clear: back",
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
      if (!touch.press?.held) forgetRow(view); // ⌫ held doesn't forget one after another
      return true;
    },
    soft: (view) => [
      action("insert", () => VIEWS.vars.pick(view)),
      action("forget", () => forgetRow(view), "", { danger: true }),
      action("undo", () => undo()),
    ],
  },

  catalog: {
    title: "catalog",
    hint: "clear: back",
    open({ query = "", replaceFrom = null }) {
      const locked = touch.mod !== "lock";
      if (locked) setMod("lock"); // the letters search; let go of again on the way out
      return { query, replaceFrom, items: catalogItems(query), ready: state.ready, info: false, locked };
    },
    count: (view) => view.items.length,
    render: renderCatalog,
    moved(view) {
      if (view.info) return renderView();
      markRow();
      renderCatalogLine(view);
    },
    type(view, char) {
      view.query += char === "␣" ? " " : char === "θ" ? "theta" : char;
      searchCatalog(view);
    },
    key(view, nav) {
      if (nav === "del") {
        if (view.query) searchCatalog(view, view.query.slice(0, -1));
      } else if (nav === "clear" && view.query) searchCatalog(view, "");
      else if (nav === "clear" && view.info) {
        view.info = false;
        renderView();
      } else if ((nav === "left" || nav === "right") && !view.query) jumpGroup(view, nav === "left" ? -1 : 1);
      else return nav === "left" || nav === "right";
      return true;
    },
    pick(view) {
      const entry = view.items[view.index];
      if (!entry) return;
      closeView();
      insertCatalogEntry(entry, view.replaceFrom); // app.js
      edited();
    },
    // opened before Python was up: its functions have come since
    refresh(view) {
      if (view.ready === state.ready) return;
      view.ready = state.ready;
      searchCatalog(view);
    },
    soft: (view) => [
      action("insert", () => VIEWS.catalog.pick(view)),
      action(view.info ? "list" : "info", () => {
        view.info = !view.info;
        renderView();
        renderSoft();
      }),
    ],
  },

  help: {
    title: "help",
    hint: "◀ ▶ sections · clear: back",
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
      if (nav === "up" || nav === "down") viewEl.querySelector(".body").scrollTop += nav === "up" ? -SCROLL_PX : SCROLL_PX;
      else if (nav === "left" || nav === "right") showSection(view, view.section + (nav === "left" ? -1 : 1));
      else return false;
      return true;
    },
    soft: (view) => helpSections().map((s, i) => action(s.dataset.tab ?? s.querySelector("h2").textContent, () => showSection(view, i), "", { on: i === view.section })),
  },
};

function openView(name, options = {}) {
  if (touch.view?.name === name) return closeView(); // its key again: back
  closeView();
  if (state.selected) select(null);
  if (touch.typing) setTyping(false);
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
  if (view.locked && touch.mod === "lock") setMod(null);
  viewEl.hidden = true;
  viewEl.replaceChildren();
  renderStrip();
  return true;
}

function renderView() {
  const view = touch.view;
  viewEl.className = `view ${view.name}`;
  viewEl.replaceChildren();
  VIEWS[view.name].render(view, viewEl);
  markRow();
}

// A key while a view shows (one that opens a menu or a view, the modifiers and undo don't
// come here): the view's if it takes it; ▲ ▼ move, enter picks and clear goes back if it
// doesn't; anything else would type into the line behind, and does nothing
function viewKey(spec) {
  const view = touch.view;
  const def = VIEWS[view.name];
  const char = isLetter(spec) ? spec.letter : spec.kind === "digit" ? spec.type : undefined;
  if (spec.nav && !def.key?.(view, spec.nav)) {
    if (spec.nav === "up" || spec.nav === "down") moveRow(spec.nav === "up" ? -1 : 1);
    else if (spec.nav === "enter") def.pick?.(view);
    else if (spec.nav === "clear") closeView();
  } else if (char !== undefined) def.type?.(view, char);
  if (touch.view) renderSoft(); // what they offer can change with the row (catalog's info)
}

function viewRow(view, i, className = "") {
  const row = el("div", ["row", i === view.index && "on", className].filter(Boolean).join(" "));
  row.dataset.i = i;
  return row;
}

// The selected row marked, and scrolled to (with its group's heading, if it's the first)
function markRow() {
  viewEl.querySelector(".row.on")?.classList.remove("on");
  const row = viewEl.querySelector(`.row[data-i="${touch.view.index}"]`);
  if (!row) return;
  row.classList.add("on");
  const scroller = row.closest(".scroll");
  const top = row.previousElementSibling?.classList.contains("group") ? row.previousElementSibling : row;
  const box = scroller.getBoundingClientRect();
  const above = box.top - top.getBoundingClientRect().top;
  const below = row.getBoundingClientRect().bottom - box.bottom;
  if (above > 0) scroller.scrollTop -= above;
  else if (below > 0) scroller.scrollTop += below;
}

// ▲ ▼: the next row, round from the last to the first, as a TI's menus do
function moveRow(delta) {
  const view = touch.view;
  const def = VIEWS[view.name];
  const n = def.count?.(view) ?? 0;
  if (!n) return;
  view.index = (view.index + delta + n) % n;
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
}

// settings: a choice (◀ ▶ or enter changes it) or a command (enter)
function settingsRows() {
  const calc = document.documentElement.classList.contains("theme-calc");
  const armed = Date.now() < touch.resetArmed;
  return [
    { label: "Input", options: ["text", "math"], value: state.mode, set: (mode) => setMode(mode).then(() => touch.view?.name === "settings" && renderView()) },
    { label: "Theme", options: ["classic", "calculator"], value: calc ? "calculator" : "classic", set: setTheme },
    { label: "Variables", go: "vars", run: () => openView("vars") },
    { label: "Catalog", go: "2nd 0", run: () => openView("catalog") },
    { label: "Help", go: "2nd settings", run: () => openView("help") },
    { label: "Clear the tape", run: () => COMMANDS.clear.run() && closeView() },
    { label: armed ? "Reset: once more to forget all variables too" : "Reset…", danger: armed, run: reset },
    { label: "Desktop layout", run: () => (location.search = "?layout=desktop") },
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

// classic (the page's own colours) or calculator (graphite, an LCD); index.html's <head>
// applies the saved one before anything renders
function setTheme(theme) {
  document.documentElement.classList.toggle("theme-calc", theme === "calculator");
  try {
    localStorage.setItem("calc.theme", theme);
  } catch {}
}

// The version (the deploy's commit, linked) and the source, under settings
function about() {
  const line = el("div", "about");
  const revision = document.getElementById("revision"); // app.js's renderAbout
  const version = revision.href ? el("a", "", revision.textContent) : el("span", "", revision.textContent);
  if (revision.href) Object.assign(version, { href: revision.href, target: "_blank", rel: "noopener" });
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

// catalog: a search line, the list (in groups until something's typed) and the selected
// entry's signature and summary; info shows all of its details instead of the list
function renderCatalog(view, node) {
  const search = el("div", "search");
  if (view.query) search.append(el("span", "query", view.query), el("span", "cursor"));
  else search.append(el("span", "placeholder", view.ready ? "letters search · ◀ ▶ groups" : "Python is loading the functions…"));
  node.append(search);
  const entry = view.items[view.index];
  if (view.info) {
    const info = el("div", "scroll info");
    if (entry) renderCatalogEntry(info, entry); // app.js
    node.append(info);
    return;
  }
  const list = el("div", "scroll");
  let group = null;
  view.items.forEach((e, i) => {
    if (!view.query && e.category !== group) {
      group = e.category;
      list.append(el("div", "group", group));
    }
    const row = viewRow(view, i);
    row.append(el("span", "name", e.name));
    if (view.query) row.append(el("span", "kind", e.category));
    list.append(row);
  });
  if (!view.items.length && view.ready) list.append(el("div", "note", "Nothing matches"));
  node.append(list, el("div", "line"));
  renderCatalogLine(view);
}

function renderCatalogLine(view) {
  const line = viewEl.querySelector(".line");
  const entry = view.items[view.index];
  line?.replaceChildren(...(entry ? [el("div", "sig", entry.signature || entry.name), el("div", "summary", entry.summary)] : []));
}

function searchCatalog(view, query = view.query) {
  view.query = query;
  view.items = catalogItems(query); // app.js
  view.index = 0;
  renderView();
}

// ◀ ▶ in the catalog: the start of this group (if not there already), the previous one,
// or the next
function jumpGroup(view, delta) {
  const starts = view.items.flatMap((e, i) => (i === 0 || e.category !== view.items[i - 1].category ? [i] : []));
  if (!starts.length) return;
  let at = starts.findLastIndex((s) => s <= view.index);
  if (!(delta < 0 && starts[at] < view.index)) at = (at + delta + starts.length) % starts.length;
  view.index = starts[at];
  VIEWS.catalog.moved(view);
}

// help: the Help panel's sections (index.html), one at a time; their tabs are the soft keys
function helpSections() {
  return [...document.querySelectorAll("#help .body > section")].filter((s) => !s.classList.contains("desktop-only"));
}

function showSection(view, i) {
  const n = helpSections().length;
  view.section = (i + n) % n;
  touch.softPage = Math.floor(view.section / SOFT_KEYS);
  renderView();
  renderSoft();
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
  let said = false;
  const text = (html) => {
    const span = el("span", "text");
    span.innerHTML = html.replace(UNDO_HINT, "").replaceAll("⌃M", "settings → Input"); // app.js
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
  // nothing else to say: how to leave a view, or (nothing on the tape yet) where the help is
  const hint = touch.view ? VIEWS[touch.view.name].hint : state.entries.length ? "" : "2nd settings: help";
  if (!said && hint) msg.append(el("span", "hint", hint));
}

// Called by app.js's renderHints: on a touch screen the status line and the soft keys say
// what the hint line would
function renderStrip() {
  if (touch.view) VIEWS[touch.view.name].refresh?.(touch.view);
  renderStatus();
  renderSoft();
}

// --- pressing ------------------------------------------------------------------------
//
// Keys act when let go. Held, a key repeats (⌫, the arrows) or does its 2nd function;
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
        run(spec.second);
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

function panelButton(text, onClick, className = "") {
  const b = el("button", className, text);
  b.type = "button";
  b.tabIndex = -1;
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

function setupTouch() {
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

  for (const root of [keypadEl, softEl]) {
    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerCancel);
    // no double-tap zoom, text selection or focus change from the keys
    root.addEventListener("touchstart", (e) => e.target.closest(".key") && e.preventDefault(), { passive: false });
    root.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  // the page dots' arrows turn the page too
  softEl.addEventListener("click", (e) => {
    const turn = e.target.closest(".turn");
    if (turn) turnPage(turn.classList.contains("back") ? -1 : 1);
  });
  viewEl.addEventListener("mousedown", (e) => e.target.closest("a") || e.preventDefault()); // keep the focus in the input
  viewEl.addEventListener("click", onViewTap);

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

// A touch device showing the keyboard layout (?layout=desktop): a way back
function offerKeypad() {
  if (!matchMedia("(hover: none) and (pointer: coarse)").matches) return;
  const b = panelButton("keypad", () => (location.search = "?layout=touch"), "command");
  document.getElementById("commands").append(b);
}

// after app.js (all deferred scripts run before DOMContentLoaded)
document.addEventListener("DOMContentLoaded", () => (TOUCH ? setupTouch() : offerKeypad()));
