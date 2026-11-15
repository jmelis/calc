// The touch layout worked by its keys alone, as on a calculator with no touch screen:
// every view opens, moves, picks and closes with key presses (taps on the keypad's keys,
// nothing else). Run by test_keypad.py: node tests/keypad.mjs <url>; prints what failed.
import { createRequire } from "module";

const { chromium, devices } = createRequire(import.meta.url)("playwright");
const url = `${process.argv[2]}?layout=touch`;
const failures = [];
const check = (ok, what, got) => ok || failures.push(`${what}: got ${JSON.stringify(got)}`);

const browser = await chromium.launch();
const page = await browser.newPage({ ...devices["iPhone 13"] });
page.on("pageerror", (e) => failures.push(`page error: ${e}`));
await page.goto(url);
try {
  await page.waitForFunction(() => typeof state !== "undefined" && state.ready, null, { timeout: 120000 });
} catch {
  // no Python (offline: Pyodide comes from the CDN): test_keypad.py skips
  console.log(await page.evaluate(() => state.status ?? "Python didn't start"));
  await browser.close();
  process.exit(77);
}

// a key of the keypad, by its label (keypad.js's KEYPAD), an arrow, or f1–f5
async function key(name) {
  const handle = await page.evaluateHandle((name) => {
    const arrows = { up: ".to-up", down: ".to-down", left: ".to-left", right: ".to-right" };
    if (arrows[name]) return document.querySelector(`#keypad .arrows ${arrows[name]}`);
    const f = name.match(/^f(\d)$/);
    if (f) return document.querySelectorAll("#keypad .frow .key")[Number(f[1]) - 1];
    return document.querySelectorAll("#keypad .ti > .key")[KEYPAD.findIndex((s) => (s.word ?? s.label) === name)];
  }, name);
  const box = await handle.asElement().boundingBox();
  // the arrows are wedges of one rocker: inside the wedge, not the middle of its box
  const [fx, fy] = { up: [0.5, 0.2], down: [0.5, 0.8], left: [0.15, 0.5], right: [0.85, 0.5] }[name] ?? [0.5, 0.5];
  await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
}
async function keys(...names) {
  for (const name of names) await key(name);
}
const now = () =>
  page.evaluate(() => ({
    input: input.value,
    view: touch.view?.name ?? null,
    row: document.querySelector(".view .row.on .name, .view .row.on .label")?.textContent ?? null,
    lock: touch.mod === "lock",
    soft: touch.soft.map((s) => s.word ?? s.label),
    names: state.names.defined,
  }));
const settle = (what) => page.waitForFunction(what, null, { timeout: 10000 });

// a = 3/7 and f(x) = x^2 + 1, with alpha for the letters
await keys("alpha", "math", "=", "3", "÷", "7", "enter");
await keys("alpha", "cos", "(", "x", ")", "=", "x", "x^2", "+", "1", "enter");
await settle(() => state.names.defined.includes("f"));

// vars: ▼ to f, enter inserts f(
await key("vars");
await settle(() => memoryState.items.length === 3);
await keys("down", "down", "enter");
let s = await now();
check(s.view === null && s.input === "f()", "vars: enter inserts the function", s);
await key("clear");

// vars: ⌫ forgets a, 2nd ⌫ brings it back, clear goes back
await keys("vars");
await settle(() => memoryState.items.length === 3);
await keys("down", "⌫");
await settle(() => memoryState.items.length === 2);
await keys("2nd", "⌫");
await settle(() => memoryState.items.length === 3);
await key("clear");
s = await now();
check(s.view === null && s.names.includes("a"), "vars: forget, undo, clear", s);

// the catalog: opens in A-LOCK, letters search, enter inserts
await keys("2nd", "0");
s = await now();
check(s.view === "catalog" && s.lock, "catalog opens in A-LOCK", s);
await keys("ln", "9"); // s q
s = await now();
check(s.row === "sqrt", "catalog: letters search", s);
await key("⌫");
await key("enter");
s = await now();
check(s.view === null && !s.lock && s.input.length > 0, "catalog: enter inserts, A-LOCK goes", s);
await key("clear");

// ◀ ▶ go from group to group; info (f2) and back; clear twice: info off, then out
await key("catalog");
const first = (await now()).row;
await keys("right", "right");
s = await now();
check(s.row !== first, "catalog: ▶ goes to the next group", s);
await key("f2");
s = await now();
check(s.soft[1] === "list", "catalog: info", s);
await key("clear");
s = await now();
check(s.view === "catalog" && s.soft[1] === "info", "catalog: clear leaves info", s);
await key("clear");
check((await now()).view === null, "catalog: clear goes back", await now());

// help: 2nd settings; ▶ the next section; its tab is a soft key
await keys("2nd", "settings");
await key("right");
const section = await page.evaluate(() => touch.view?.section);
check(section === 1, "help: ▶ the next section", section);
await key("f1");
check((await page.evaluate(() => touch.view?.section)) === 0, "help: f1 its first section", section);

// settings, from help; ◀ ▶ change a setting; its key again goes back
await key("settings");
s = await now();
check(s.view === "settings" && s.row === "Input", "settings opens", s);
await keys("down", "right");
check(await page.evaluate(() => document.documentElement.classList.contains("theme-calc")), "settings: ▶ changes the theme", null);
await key("left");
await key("settings");
check((await now()).view === null, "settings: its key again goes back", await now());

// anything that would type into the line behind a view does nothing
await keys("vars", "7", "sin", "clear");
s = await now();
check(s.input === "", "a view keeps keys from the line", s);

console.log(failures.join("\n"));
await browser.close();
process.exit(failures.length ? 1 : 0);
