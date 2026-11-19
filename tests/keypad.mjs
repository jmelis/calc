// The touch layout worked by its keys alone, as on a calculator with no touch screen:
// the menus, every view (opens, moves, picks, closes) and the keys' shift and alpha
// functions, with key presses (taps on the keypad's keys, nothing else). Run by
// test_keypad.py: node tests/keypad.mjs <url>; prints what failed.
import { createRequire } from "module";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const url = process.argv[2];
const failures = [];
const check = (ok, what, got) => ok || failures.push(`${what}: got ${JSON.stringify(got)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["iPhone 13"] });
page.on("pageerror", (e) => failures.push(`page error: ${e}`));
await page.goto(url);
try {
  await page.waitForFunction(() => typeof state !== "undefined" && state.ready && MENUS, null, { timeout: 120000 });
} catch {
  // no Python (offline: Pyodide comes from the CDN): test_keypad.py skips
  console.log(await page.evaluate(() => state.status ?? "Python didn't start"));
  await browser.close();
  process.exit(77);
}

// a key of the keypad by its label (keypad.js's KEYPAD; LaTeX ones as they look), or F1–F5
async function key(name) {
  name = { π: "\\pi" }[name] ?? name;
  const box = await page.evaluate((name) => {
    const f = name.match(/^F(\d)$/);
    const i = f ? Number(f[1]) - 1 : KEYPAD.findIndex((s) => s.soft === undefined && (s.word ?? s.label) === name);
    const r = document.querySelectorAll("#keypad .grid > .key")[i].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  await page.touchscreen.tap(box.x, box.y);
}
async function keys(...names) {
  for (const name of names) await key(name);
}
const now = () =>
  page.evaluate(() => ({
    input: input.value,
    view: touch.view?.name ?? null,
    title: touch.view ? title(touch.view) : null,
    row: document.querySelector(".view .row.on .name, .view .row.on .label")?.textContent ?? null,
    lock: touch.alpha === "lock",
    group: touch.view?.group ?? null,
    path: touch.path.join("/"),
    soft: touch.soft.map((s) => s?.word ?? s?.label ?? null),
    names: state.names.defined,
  }));
const settle = (what, arg) => page.waitForFunction(what, arg, { timeout: 10000 });
const last = () => page.evaluate(() => state.entries.at(-1));

// a = 3/7 and f(x) = x^2 + 1, with alpha for the letters (a on menu, f on the comma)
await keys("alpha", "menu", "=", "3", "÷", "7", "enter");
await keys("alpha", ",", "(", "x", ")", "=", "x", "^", "2", "+", "1", "enter");
await settle(() => state.names.defined.includes("f"));

// vars (shift x): ▼ to f, enter inserts f(
await keys("shift", "x");
await settle(() => memoryState.items.length === 3);
await keys("▼", "▼", "enter");
let s = await now();
check(s.view === null && s.input === "f()", "vars: enter inserts the function", s);
await key("esc");

// vars: ⌫ forgets a, shift ⌫ brings it back, esc goes back
await keys("shift", "x");
await settle(() => memoryState.items.length === 3);
await keys("▼", "⌫");
await settle(() => memoryState.items.length === 2);
await keys("shift", "⌫");
await settle(() => memoryState.items.length === 3);
await key("esc");
s = await now();
check(s.view === null && s.names.includes("a"), "vars: forget, undo, esc", s);

// alpha twice locks the letters; the arrows stay arrows; esc lets go of the letters first
await keys("alpha", "alpha", "menu", "trig", "◀", "^", "esc");
s = await now();
check(s.input === "acb" && !s.lock, "A-LOCK: a, b, ◀ moves back, c; esc ends it", s);
await key("esc");
check((await now()).input === "", "esc: then the line", await now());

// shift and alpha: a capital; shift's functions
await keys("alpha", "shift", "trig", "shift", "π", "shift", "ans");
check((await now()).input === "BIE", "alpha shift: a capital; shift π: i; shift ans: E", await now());
await key("esc");

// the menus: the menu key lists them, F picks one, menu goes back up and back again
await keys("menu");
s = await now();
check(s.path === "top" && s.soft[0] === "calc" && s.soft[5] === "trig", "menu: the menu of menus", s);
await key("F2");
check((await now()).path === "top/alg", "F2: alg", await now());
await key("F1");
check((await now()).input === "solve(, x)", "alg F1: solve", await now());
await keys("esc", "menu");
check((await now()).path === "top", "menu: up to the top", await now());
await key("menu");
check((await now()).path === "top/alg", "menu again: back to alg", await now());

// trig and shift trig; shift F is the upper row
await keys("trig", "F1");
s = await now();
check(s.path === "top/trig" && s.input === "sin()", "trig F1: sin", s);
await keys("esc", "shift", "F1");
check((await now()).input === "asin()", "trig shift F1: sin⁻¹", await now());
await keys("esc", "shift", "trig");
check((await now()).path === "top/hyp", "shift trig: hyp", await now());
await keys("shift", "=");
check((await now()).path === "top/test", "shift =: the comparisons", await now());

// completions on the soft keys while typing in alpha
await keys("alpha", "alpha", "1", "7"); // s i
s = await now();
check(s.soft.includes("sin"), "completions while typing", s);
await keys("alpha", "F1");
check((await now()).input === "sin()", "a completion inserts", await now());
await key("esc");

// shift enter: the result as a decimal; ▲ then ◀ ▶ flip it
await keys("1", "÷", "3", "shift", "enter");
await settle(() => state.entries.at(-1).result);
check((await last()).view === "float", "shift enter: a decimal", await last());
await keys("▲", "◀");
check((await last()).view === "exact", "▲ ◀: exact again", await last());
await keys("▶", "esc");
check((await last()).view === "float", "▶: the decimal", await last());

// the catalog (shift menu): opens in A-LOCK, groups on the soft keys, letters jump, enter
// inserts and lets go of the letters
await keys("shift", "menu");
s = await now();
check(s.view === "catalog" && s.lock && s.soft[0] === "all", "catalog: A-LOCK, the groups on the soft keys", s);
await key("F3");
check((await now()).group === "Calculator", "catalog: a soft key picks a group", await now());
await keys("1", "−"); // s q
s = await now();
check(s.row === "sqrt", "catalog: letters jump to the entry", s);
await key("enter");
s = await now();
check(s.view === null && s.input === "sqrt()" && !s.lock, "catalog: enter inserts, A-LOCK goes", s);
await key("esc");

// a help page: ▶ opens it, its related entries on the soft keys, ◀ back the way it came
await keys("shift", "menu", "1", "5", "×"); // s o l: solve
await key("▶");
s = await now();
check(s.title === "help" && s.soft.includes("nsolve"), "catalog: ▶ a help page, related on the soft keys", s);
await key("F1");
s = await now();
const first = await page.evaluate(() => touch.view.pages.at(-1).name);
check(first === "nsolve" && s.title === "help", "help page: a soft key follows a link", first);
await keys("◀", "◀");
s = await now();
check(s.title === "catalog" && s.row === "solve", "help page: ◀ back the way it came", s);
await keys("▶", "enter");
check((await now()).input === "solve()", "help page: enter inserts", await now());
await keys("esc");

// help (menu, shift F5): ▶ the next section; its tab is a soft key
await keys("menu", "shift", "F5");
await key("▶");
check((await page.evaluate(() => touch.view?.section)) === 1, "help: ▶ the next section", null);
await key("F1");
check((await page.evaluate(() => touch.view?.section)) === 0, "help: F1 its first section", null);

// setup (menu, shift F4), from help; esc goes back
await keys("menu", "shift", "F4");
s = await now();
check(s.view === "settings" && s.row === "Input", "setup opens", s);
await key("esc");
check((await now()).view === null, "setup: esc goes back", await now());

// shift esc clears the tape, shift ⌫ brings it back
const entries = await page.evaluate(() => state.entries.length);
await keys("shift", "esc");
await settle(() => state.entries.length === 0);
await keys("shift", "⌫");
await settle((n) => state.entries.length === n, entries);

// anything that would type into the line behind a view does nothing
await keys("shift", "x", "7", "ln", "esc");
s = await now();
check(s.input === "", "a view keeps keys from the line", s);

// the last row's letters: w y z on 0 . ans; the rest in chars (shift alpha), Greek in it
await keys("alpha", "0", "alpha", ".", "alpha", "ans");
check((await now()).input === "wyz", "alpha 0 . ans: w y z", await now());
await keys("shift", "alpha");
check((await now()).path === "top/chars", "shift alpha: chars", await now());
await keys("F1", "F2", "x", "shift", "F1");
check((await now()).input === "wyz _x!", "chars: a space, _, and ! with shift", await now());
await keys("shift", "▼", "F4");
check((await now()).path === "top/chars/greek", "chars' page 2: greek", await now());
await keys("F5", "menu");
s = await now();
check(s.input === "wyz _x!lamda" && s.path === "top/chars", "greek F5: lamda; menu back up to chars", s);
await key("esc");

// a computer's keyboard works a view as the keypad does
await keys("shift", "x");
await settle(() => memoryState.items.length === 3);
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await page.keyboard.press("Enter");
s = await now();
check(s.view === null && s.input === "f()", "keyboard: arrows and ⏎ in vars", s);
await key("esc");
await keys("shift", "menu");
await page.keyboard.type("sq");
s = await now();
check(s.row === "sqrt", "keyboard: letters jump in the catalog", s);
await page.keyboard.press("Escape");
check((await now()).view === "catalog", "keyboard: Esc clears what was typed first", await now());
await page.keyboard.press("Escape");
s = await now();
check(s.view === null && s.input === "", "keyboard: then Esc goes back", s);

console.log(failures.join("\n"));
await browser.close();
process.exit(failures.length ? 1 : 0);
