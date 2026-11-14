// What a server would do, in the page: keeps the tape, saves it and the Python
// variables in IndexedDB, and runs the Python worker (worker.js).
//
// The page sends it messages ({type: "eval" | "preview" | "interrupt" | "clear" |
// "delete" | "reset" | "vars" | "forget" | "undo" | "sample", ...}) and gets back the same
// kinds of messages a server would push ({type: "init" | "pending" | "entry" | "tape" |
// "preview" | "names" | "vars" | "status" | "ready" | "undone" | "samples", ...}). Like a server's, they're copies: the page
// changes what it receives (adds entries, sets views), and that mustn't reach the tape.

class Interrupted extends Error {}

// The deploy stamps index.html's script URLs with the commit (backend.js?v=…), so a new
// deploy reaches the next reload instead of waiting out the browser's cache; pass it on
const VERSION = new URL(document.currentScript.src).search;

const store = {
  // a minimal key-value store on IndexedDB: the tape (with plot images) outgrows localStorage
  db: null,

  open() {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("calc", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("kv");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  },

  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction("kv").objectStore("kv").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

class Backend {
  constructor(emit) {
    this.emit = (message) => emit(structuredClone(message));
    this.tape = { next_id: 1, entries: [] };
    this.state = null; // pickled variables from the worker (base64), restored on restart
    this.names = { variables: [], functions: [], defined: [] };
    this.catalog = [];
    this.worker = null;
    this.requests = new Map(); // id -> {resolve, reject}
    this.nextRequest = 1;
    this.ready = false; // Python is up (requests sent before that wait in the worker's queue)
    this.queued = []; // messages that arrived before there was a worker to send them to
    this.running = 0; // evaluations in the worker; previews wait for them
    this.deferredPreviews = new Map(); // target -> latest preview request while busy
    // what Ctrl+Z can take back: {kind: "delete" | "clear", entries} |
    // {kind: "forget", name, saved}. In memory only; :reset empties it
    this.undoStack = [];
  }

  async start() {
    if (location.protocol === "file:") {
      // browsers don't run workers (or let them fetch py/calc/) for file:// pages
      this.status("Open this page through a web server, not as a file: run `make serve` in the repo, then go to http://127.0.0.1:8000");
      return;
    }
    try {
      const [tape, state] = await Promise.all([store.get("tape"), store.get("state")]);
      if (tape) this.tape = tape;
      this.state = state ?? null;
    } catch {
      // private windows can refuse IndexedDB: work without saving
    }
    // show the saved tape now; Python takes a few seconds and isn't needed to read it
    this.emit({ type: "init", entries: this.tape.entries });
    await this.startWorker();
  }

  async startWorker() {
    this.ready = false;
    try {
      this.worker = new Worker(`worker.js${VERSION}`, { type: "module" });
    } catch (e) {
      this.status(`Couldn't start Python: ${e.message}`);
      return;
    }
    this.worker.onmessage = (event) => this.onWorkerMessage(event.data);
    this.worker.onerror = (event) => this.status(`Python worker failed: ${event.message}`);
    // the worker answers in order, so anything sent from here on runs once init is done
    const starting = this.request("init", { state: this.state });
    this.queued.splice(0).forEach((msg) => this.handle(msg));
    try {
      const { catalog, names } = await starting;
      this.catalog = catalog;
      this.names = names;
    } catch (e) {
      if (!(e instanceof Interrupted)) this.status(`Couldn't start Python: ${e.message}`);
      return;
    }
    this.ready = true;
    this.status(null);
    this.emit({ type: "ready", catalog: this.catalog, names: this.names });
    if (!this.running) this.flushPreviews();
  }

  stopWorker() {
    this.worker?.terminate();
    for (const { reject } of this.requests.values()) reject(new Interrupted("Interrupted"));
    this.requests.clear();
    this.running = 0;
    this.deferredPreviews.clear();
  }

  status(text, fraction = null) {
    this.emit({ type: "status", text, fraction });
  }

  request(op, args = {}) {
    const id = this.nextRequest++;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, ...args });
    });
  }

  onWorkerMessage(msg) {
    if ("progress" in msg) {
      this.status(msg.progress, msg.fraction);
      return;
    }
    const pending = this.requests.get(msg.id);
    if (!pending) return;
    this.requests.delete(msg.id);
    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error));
  }

  save() {
    store.set("tape", this.tape).catch(() => {});
    store.set("state", this.state).catch(() => {});
  }

  // --- messages from the page ---------------------------------------------------

  handle(msg) {
    if (!this.worker && !["interrupt", "clear", "delete", "undo"].includes(msg.type)) {
      this.queued.push(msg); // still reading the saved tape; sent once the worker exists
      return true;
    }
    switch (msg.type) {
      case "eval":
        this.evaluate(msg.src);
        break;
      case "preview":
        this.preview(msg);
        break;
      case "interrupt":
        this.interrupt();
        break;
      case "clear":
        if (this.tape.entries.length) this.undoStack.push({ kind: "clear", entries: this.tape.entries });
        this.tape.entries = [];
        this.save();
        this.emit({ type: "tape", entries: [] });
        break;
      case "delete": { // msg.ids; the page has already removed them from view
        const ids = new Set(msg.ids);
        const entries = this.tape.entries.filter((e) => ids.has(e.id));
        if (entries.length) this.undoStack.push({ kind: "delete", entries });
        this.tape.entries = this.tape.entries.filter((e) => !ids.has(e.id));
        this.save();
        break;
      }
      case "undo":
        this.undo();
        break;
      case "sample":
        this.sample(msg);
        break;
      case "reset":
        this.reset();
        break;
      case "vars":
        this.variables("vars");
        break;
      case "forget":
        this.variables("forget", { name: msg.name });
        break;
      default:
        return false;
    }
    return true;
  }

  async evaluate(src) {
    const tape = this.tape; // a :reset while this runs starts a new tape; don't add to it
    const id = tape.next_id++;
    this.emit({ type: "pending", id, input: src, input_latex: null });
    this.running++;
    let payload;
    try {
      payload = await this.request("run", { src, entryId: id });
    } catch (e) {
      payload = { error: e.message, outputs: [] };
    } finally {
      this.running = Math.max(0, this.running - 1);
    }
    const entry = {
      id,
      input: src,
      input_latex: payload.input_latex ?? null,
      outputs: payload.outputs ?? [],
      result: payload.result ?? null,
      error: payload.error ?? null,
    };
    if (tape !== this.tape) return;
    if (payload.names) this.names = payload.names;
    if (payload.state) this.state = payload.state;
    tape.entries.push(entry);
    this.save();
    this.emit({ type: "entry", entry, names: this.names });
    if (!this.running) this.flushPreviews();
  }

  // previews are answered in the worker too; while it computes, keep only the latest
  async preview(msg) {
    if (this.running || !this.ready) {
      this.deferredPreviews.set(msg.target, msg);
      return;
    }
    let latex = null;
    try {
      latex = await this.request("preview", { src: msg.src, target: msg.target });
    } catch {
      // interrupted or failed: no preview
    }
    this.emit({ type: "preview", target: msg.target, seq: msg.seq, latex });
  }

  flushPreviews() {
    const waiting = [...this.deferredPreviews.values()];
    this.deferredPreviews.clear();
    waiting.forEach((msg) => this.preview(msg));
  }

  async variables(op, args = {}) {
    try {
      const { items, names, state, saved } = await this.request(op, args);
      if (op === "forget" && saved) this.undoStack.push({ kind: "forget", name: args.name, saved });
      this.names = names;
      if (state) {
        this.state = state;
        this.save();
      }
      this.emit({ type: "names", names });
      this.emit({ type: "vars", items });
    } catch (e) {
      this.emit({ type: "vars", items: [], error: e.message });
    }
  }

  // Python can't be interrupted mid-computation without special server headers, so
  // stop the worker and start a fresh one with the variables saved after the last run
  interrupt() {
    if (!this.running) return;
    this.stopWorker();
    this.startWorker();
  }

  // an iplot graph was zoomed or panned: Python samples the new range
  async sample({ key, seq, exprs, variable, xmin, xmax }) {
    try {
      const data = await this.request("sample", { exprs, variable, xmin, xmax });
      this.emit({ type: "samples", key, seq, data });
    } catch (e) {
      this.emit({ type: "samples", key, seq, error: e.message });
    }
  }

  // Ctrl+Z: takes back the last delete, :clear or forget (not evaluations, not :reset)
  undo() {
    const last = this.undoStack.pop();
    if (!last) {
      this.emit({ type: "undone", text: "Nothing to undo" });
      return;
    }
    if (last.kind === "forget") {
      this.variables("unforget", { name: last.name, saved: last.saved });
      this.emit({ type: "undone", text: `Restored ${last.name}` });
      return;
    }
    // back in their places, among whatever was evaluated since
    this.tape.entries = [...last.entries, ...this.tape.entries].sort((a, b) => a.id - b.id);
    this.save();
    this.emit({ type: "tape", entries: this.tape.entries });
    const [first] = last.entries;
    const text =
      last.kind === "clear" ? "Restored the tape"
      : last.entries.length > 1 ? `Restored ${last.entries.length} entries`
      : `Restored entry ${first.id}`;
    this.emit({ type: "undone", text });
  }

  reset() {
    this.undoStack = [];
    this.stopWorker();
    this.tape = { next_id: 1, entries: [] };
    this.state = null;
    this.save();
    this.emit({ type: "init", entries: [] });
    this.startWorker();
  }
}
