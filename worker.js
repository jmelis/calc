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
const PY_FILES = ["__init__.py", "parser.py", "preview.py", "session.py", "catalog.py", "stats.py", "vectors.py"];

// SymPy and mpmath precompiled to bytecode by tools/build_bundle.py at deploy time:
// imports ~5x faster than Pyodide's source packages. Without it (a checkout where it
// hasn't been built), the source packages are used instead and everything still works.
const BUNDLE = "sympy-bytecode.zip";
const BUNDLE_PATH = `/home/pyodide/${BUNDLE}`;
// The same for matplotlib and its dependencies, fetched with them on the first plot
const PLOT_BUNDLE = "plot-bytecode.zip";
const PLOT_BUNDLE_PATH = `/home/pyodide/${PLOT_BUNDLE}`;

// Download sizes as the browser sees them (decompressed), for the progress bar.
// Pyodide doesn't report download progress, so these are fetched first, counting
// bytes, and Pyodide then gets them from the HTTP cache. When bumping PYODIDE_VERSION,
// update them (curl -s --compressed URL | wc -c); a stale size only makes the bar less
// accurate. The bundle's real size comes from its Content-Length.
const RUNTIME = { "pyodide.asm.wasm": 9598218, "python_stdlib.zip": 2545637 };
const SOURCE_PACKAGES = { "sympy-1.14.0-py3-none-any.whl": 4185567, "mpmath-1.4.1-py3-none-any.whl": 430985 };
const BUNDLE_SIZE_GUESS = 7.7e6; // until its Content-Length arrives
const DOWNLOAD_SHARE = 0.85; // of the bar; starting Python and importing SymPy take the rest
const STALL_MS = 15000;

// The page talks JSON with the session; this glue keeps Pyodide's proxies out of it
const GLUE = `
import base64, json, sys
sys.path.insert(0, "/home/pyodide")
from calc.session import Session, configure_matplotlib, warm_up_plotting

def _start(state_b64):
    global session
    session = Session(base64.b64decode(state_b64) if state_b64 else None)
    return json.dumps({"catalog": session.catalog(), "names": session.names()})

def _call(method, args_json):
    return json.dumps(getattr(session, method)(*json.loads(args_json)))

def _state():
    return base64.b64encode(session.state()).decode()

def _unpack_bytecode(path):
    # __pycache__/*.pyc next to the installed sources, which Python then uses
    import os, sysconfig, zipfile
    with zipfile.ZipFile(path) as bundle:
        bundle.extractall(sysconfig.get_path("purelib"))
    os.remove(path)
`;

let pyodide = null;
let pyCall = null; // GLUE's functions, fetched once: each globals.get makes a proxy
let pyState = null;
let usingBundle = false;
let plotting = null; // a promise, once matplotlib has started loading

const progress = (text, fraction) => self.postMessage({ progress: text, fraction });
const mb = (bytes) => (bytes / 1e6).toFixed(1);
const call = (method, ...args) => JSON.parse(pyCall(method, JSON.stringify(args)));

// Fetches everything Pyodide needs, counting bytes for the progress bar. Returns the
// bundle's bytes, or null when there's no bundle (the source packages are then fetched
// instead, to warm the cache for loadPackage).
async function download() {
  const sizes = { ...RUNTIME, [BUNDLE]: BUNDLE_SIZE_GUESS };
  const total = () => Object.values(sizes).reduce((a, b) => a + b, 0);
  let loaded = 0;
  let lastByte = Date.now();
  let lastReport = 0;
  const report = (force = false) => {
    if (!force && Date.now() - lastReport < 100) return;
    lastReport = Date.now();
    const stalled = Date.now() - lastByte > STALL_MS;
    progress(
      stalled
        ? `Download stalled at ${mb(loaded)} of ${mb(total())} MB: check your connection (still trying)`
        : `Downloading Python and SymPy… ${mb(loaded)} of ${mb(total())} MB`,
      Math.min(loaded / total(), 1) * DOWNLOAD_SHARE,
    );
  };

  // reads a response to the end, counting it against `name`'s size; keep=true returns the bytes
  const read = async (name, response, keep = false) => {
    const reader = response.body.getReader();
    const chunks = [];
    let counted = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByte = Date.now();
      if (keep) chunks.push(value);
      const add = Math.min(value.length, sizes[name] - counted); // a stale size mustn't overshoot
      counted += add;
      loaded += add;
      report();
    }
    loaded += sizes[name] - counted; // and one that's too big still completes
    if (!keep) return null;
    const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  };

  const fetchCounted = async (name, url, keep = false) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`couldn't download ${name} (HTTP ${response.status})`);
    return read(name, response, keep);
  };

  const bundle = async () => {
    const response = await fetch(new URL(BUNDLE, self.location)).catch(() => null);
    if (!response?.ok) {
      // no bundle here: Pyodide's source packages instead
      delete sizes[BUNDLE];
      Object.assign(sizes, SOURCE_PACKAGES);
      await Promise.all(Object.keys(SOURCE_PACKAGES).map((file) => fetchCounted(file, PYODIDE_URL + file)));
      return null;
    }
    sizes[BUNDLE] = Number(response.headers.get("Content-Length")) || BUNDLE_SIZE_GUESS;
    return read(BUNDLE, response, true);
  };

  const watchdog = setInterval(() => report(true), 1000);
  try {
    const [bytes] = await Promise.all([
      bundle(),
      ...Object.keys(RUNTIME).map((file) => fetchCounted(file, PYODIDE_URL + file)),
    ]);
    report(true);
    return bytes;
  } finally {
    clearInterval(watchdog);
  }
}

const OPS = {
  async init({ state }) {
    progress("Downloading Python and SymPy…", 0);
    // imported here rather than at the top, so onmessage is set before anything awaits
    const [{ loadPyodide }, bundle] = await Promise.all([import(`${PYODIDE_URL}pyodide.mjs`), download()]);
    progress("Starting Python…", 0.9);
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    progress("Starting SymPy…", 0.95);
    if (bundle) {
      // imported straight from the zip (zipimport), ahead of site-packages
      pyodide.FS.writeFile(BUNDLE_PATH, bundle);
      pyodide.runPython(`import sys; sys.path.insert(0, "${BUNDLE_PATH}")`);
      usingBundle = true;
    } else {
      await pyodide.loadPackage("sympy");
    }
    pyodide.FS.mkdirTree("/home/pyodide/calc");
    await Promise.all(
      PY_FILES.map(async (file) => {
        const response = await fetch(new URL(`py/calc/${file}`, self.location));
        if (!response.ok) throw new Error(`couldn't fetch py/calc/${file}`);
        pyodide.FS.writeFile(`/home/pyodide/calc/${file}`, await response.text());
      }),
    );
    pyodide.runPython(GLUE);
    pyCall = pyodide.globals.get("_call");
    pyState = pyodide.globals.get("_state");
    const start = pyodide.globals.get("_start");
    const started = JSON.parse(start(state ?? null));
    start.destroy();
    progress(null);
    return started;
  },

  async run({ src, entryId }) {
    await loadPackagesFor(src);
    const payload = call("run", src, entryId);
    payload.state = pyState();
    return payload;
  },

  preview({ src, target }) {
    // typing a plot: start loading matplotlib now, so it's ready (or nearly) by ⏎
    if (target === "input" && /plot/.test(src)) loadPlotting().catch(() => {}); // run reports failures
    return call("preview", src);
  },
  vars: () => ({ items: call("variables"), names: call("names") }),
  forget: ({ name }) => {
    const saved = call("pickled", name); // for undo, before it's gone
    return { items: call("forget", name), names: call("names"), state: pyState(), saved };
  },
  unforget: ({ name, saved }) => ({ items: call("unforget", name, saved), names: call("names"), state: pyState() }),
};

// matplotlib is big, so it's only fetched when something plots (or is being typed).
// Its precompiled bytecode comes with it, and a throwaway plot does the first plot's
// one-time work (importing pyplot, lambdify's numpy printer), so the first real one is
// as fast as any other. Without the bundle, matplotlib compiles from source as usual.
function loadPlotting() {
  plotting ??= (async () => {
    progress("Loading matplotlib (first plot only)…");
    const [, bytecode] = await Promise.all([
      pyodide.loadPackage("matplotlib"),
      fetch(new URL(PLOT_BUNDLE, self.location))
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null),
    ]);
    if (bytecode) {
      pyodide.FS.writeFile(PLOT_BUNDLE_PATH, new Uint8Array(bytecode));
      pyodide.runPython(`_unpack_bytecode("${PLOT_BUNDLE_PATH}")`);
    }
    pyodide.runPython("configure_matplotlib(); warm_up_plotting()");
  })()
    .catch((e) => {
      plotting = null; // try again next time
      throw e;
    })
    .finally(() => progress(null));
  return plotting;
}

// imports in Python lines (import numpy) are fetched the same way
async function loadPackagesFor(src) {
  if (/plot/.test(src)) await loadPlotting();
  if (/\bimport\b/.test(src)) {
    const findImports = pyodide.pyimport("pyodide.code").find_imports;
    // sympy and mpmath already come from the bundle; don't fetch their source packages too
    const wanted = findImports(src).toJs().filter((name) => !(usingBundle && ["sympy", "mpmath"].includes(name)));
    if (wanted.length) await pyodide.loadPackagesFromImports(wanted.map((name) => `import ${name}`).join("\n"));
  }
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
