// Runs the calculator's Python (py/calc/) in Pyodide, off the page's thread, so a
// long computation doesn't freeze the page and can be stopped by terminating this
// worker (see backend.js). A module worker: importScripts() of Pyodide's classic
// script fails in Chrome, while importing pyodide.mjs works.
//
// Requests are {id, op, ...args}; each is answered with {id, ok, result} or
// {id, ok: false, error}, one at a time in arrival order. {progress, fraction}
// messages report what's loading (fraction is 0..1 while starting up, else absent).

const PYODIDE_VERSION = "314.0.7"; // ships sympy 1.14.0; keep pyproject.toml's dev pin in step
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const PY_FILES = ["__init__.py", "parser.py", "preview.py", "session.py", "catalog.py", "stats.py"];

// The big downloads and their sizes as the browser sees them (decompressed), for the
// pinned Pyodide version. Pyodide doesn't report download progress, so these are
// fetched first, counting bytes; Pyodide then gets them from the HTTP cache. When
// bumping PYODIDE_VERSION, update these (curl -s --compressed URL | wc -c); a stale
// size only makes the bar less accurate.
const DOWNLOADS = {
  "pyodide.asm.wasm": 9598218,
  "python_stdlib.zip": 2545637,
  "sympy-1.14.0-py3-none-any.whl": 4185567,
  "mpmath-1.4.1-py3-none-any.whl": 430985,
};
const DOWNLOAD_SHARE = 0.85; // of the bar; starting Python and importing SymPy take the rest
const STALL_MS = 15000;


// The page talks JSON with the session; this glue keeps Pyodide's proxies out of it
const GLUE = `
import base64, json, sys
sys.path.insert(0, "/home/pyodide")
from calc.session import Session, configure_matplotlib

def _start(state_b64):
    global session
    session = Session(base64.b64decode(state_b64) if state_b64 else None)
    return json.dumps({"catalog": session.catalog(), "names": session.names()})

def _call(method, args_json):
    return json.dumps(getattr(session, method)(*json.loads(args_json)))

def _state():
    return base64.b64encode(session.state()).decode()
`;

let pyodide = null;
let matplotlibLoaded = false;

const progress = (text, fraction) => self.postMessage({ progress: text, fraction });
const mb = (bytes) => (bytes / 1e6).toFixed(1);

async function download() {
  const total = Object.values(DOWNLOADS).reduce((a, b) => a + b, 0);
  let loaded = 0;
  let lastByte = Date.now();
  let lastReport = 0;
  const report = (force = false) => {
    if (!force && Date.now() - lastReport < 100) return;
    lastReport = Date.now();
    const fraction = Math.min(loaded / total, 1) * DOWNLOAD_SHARE;
    const stalled = Date.now() - lastByte > STALL_MS;
    progress(
      stalled
        ? `Download stalled at ${mb(loaded)} of ${mb(total)} MB: check your connection (still trying)`
        : `Downloading Python and SymPy… ${mb(loaded)} of ${mb(total)} MB`,
      fraction,
    );
  };
  const watchdog = setInterval(() => report(true), 1000);
  try {
    await Promise.all(
      Object.entries(DOWNLOADS).map(async ([file, size]) => {
        const response = await fetch(PYODIDE_URL + file);
        if (!response.ok) throw new Error(`couldn't download ${file} (HTTP ${response.status})`);
        const reader = response.body.getReader();
        let counted = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          lastByte = Date.now();
          const add = Math.min(value.length, size - counted); // a stale size mustn't overshoot
          counted += add;
          loaded += add;
          report();
        }
        loaded += size - counted; // and one that's too big still completes
      }),
    );
  } finally {
    clearInterval(watchdog);
  }
  report(true);
}
const py = (name) => pyodide.globals.get(name);
const call = (method, ...args) => JSON.parse(py("_call")(method, JSON.stringify(args)));

const OPS = {
  async init({ state }) {
    progress("Downloading Python and SymPy…", 0);
    // imported here rather than at the top, so onmessage is set before anything awaits
    const [{ loadPyodide }] = await Promise.all([import(`${PYODIDE_URL}pyodide.mjs`), download()]);
    progress("Starting Python…", 0.9);
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    progress("Starting SymPy…", 0.95);
    await pyodide.loadPackage("sympy");
    pyodide.FS.mkdirTree("/home/pyodide/calc");
    await Promise.all(
      PY_FILES.map(async (file) => {
        const response = await fetch(new URL(`py/calc/${file}`, self.location));
        if (!response.ok) throw new Error(`couldn't fetch py/calc/${file}`);
        pyodide.FS.writeFile(`/home/pyodide/calc/${file}`, await response.text());
      }),
    );
    pyodide.runPython(GLUE);
    const started = JSON.parse(py("_start")(state ?? null));
    progress(null);
    return started;
  },

  async run({ src, entryId }) {
    await loadPackagesFor(src);
    const payload = call("run", src, entryId);
    payload.state = py("_state")();
    return payload;
  },

  preview: ({ src }) => call("preview", src),
  vars: () => ({ items: call("variables"), names: call("names") }),
  forget: ({ name }) => ({ items: call("forget", name), names: call("names"), state: py("_state")() }),
};

// matplotlib is big, so it's only fetched when something plots; imports in Python
// lines (import numpy) are fetched the same way
async function loadPackagesFor(src) {
  if (!matplotlibLoaded && /plot/.test(src)) {
    progress("Loading matplotlib (first plot only)…");
    await pyodide.loadPackage("matplotlib");
    pyodide.runPython("configure_matplotlib()");
    matplotlibLoaded = true;
  }
  if (/\bimport\b/.test(src)) await pyodide.loadPackagesFromImports(src);
  progress(null);
}

let queue = Promise.resolve();

self.onmessage = (event) => {
  const { id, op, ...args } = event.data;
  queue = queue.then(async () => {
    try {
      self.postMessage({ id, ok: true, result: await OPS[op](args) });
    } catch (e) {
      self.postMessage({ id, ok: false, error: String(e?.message ?? e) });
    }
  });
};
