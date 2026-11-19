// Interactive graphs (iplot): uPlot draws the points Python sampled (graphs.py), and
// zooming or panning asks Python, through the backend, for samples of the new range.
// uPlot is only fetched when the first graph is drawn.
//
// Mouse: drag (or swipe sideways) to pan, pinch (or Ctrl+wheel) to zoom, Shift+drag to
// zoom into a range, double-click to reset. Touch: drag sideways to pan, pinch to zoom.
// Keyboard, with the graph selected on the tape: ← → pan, + − zoom, 0 reset.

const UPLOT_URL = "https://cdn.jsdelivr.net/npm/uplot@1.6.32/dist/";
const GRAPH_COLORS = ["--accent", "#2563eb", "#16a34a", "#9333ea", "#ca8a04", "#0891b2"];
const RESAMPLE_MS = 120; // after the view stops changing

let uplotLoading = null;
const graphs = new Map(); // entry id -> Graph

function loadUPlot() {
  uplotLoading ??= new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `${UPLOT_URL}uPlot.min.css`;
    document.head.append(css);
    const script = document.createElement("script");
    script.src = `${UPLOT_URL}uPlot.iife.min.js`;
    script.onload = () => resolve(window.uPlot);
    script.onerror = () => {
      uplotLoading = null;
      reject(new Error("couldn't load the graphing library"));
    };
    document.head.append(script);
  });
  return uplotLoading;
}

// x arrives as [from, to, n]: evenly spaced, so it isn't sent point by point
function graphData({ x: [from, to, n], ys }) {
  const xs = Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  return [xs, ...ys];
}

class Graph {
  // out: the graph output ({exprs, labels, texts, var, range, data}); send: to the backend
  constructor(node, entryId, out, send) {
    this.node = node;
    this.key = entryId;
    this.out = out;
    this.send = send;
    this.y = out.data.y;
    this.shown = [out.data.x[0], out.data.x[1]]; // the x range the current samples cover
    this.seq = 0;
    this.timer = null;
    this.plot = null;
  }

  async draw() {
    const uPlot = await loadUPlot();
    if (!this.node.isConnected) return; // re-rendered meanwhile
    const style = getComputedStyle(document.documentElement);
    const color = (c) => (c.startsWith("--") ? style.getPropertyValue(c).trim() : c);
    const axis = { stroke: color("--muted"), grid: { stroke: color("--faint"), width: 1 }, ticks: { stroke: color("--faint") } };
    const width = this.width() || 600;
    this.plot = new uPlot(
      {
        width,
        height: this.height(width),
        scales: { x: { time: false }, y: { range: () => this.y } },
        axes: [axis, axis],
        series: [
          { label: this.out.var_name },
          ...this.out.exprs.map((_, i) => ({
            label: (this.out.texts?.[i] ?? "").replaceAll("**", "^"),
            stroke: color(GRAPH_COLORS[i % GRAPH_COLORS.length]),
            width: 2,
          })),
        ],
        cursor: {
          drag: { x: true, y: false },
          bind: { dblclick: () => () => (this.reset(), null) },
        },
        // u, not this.plot: it fires while the constructor is still running
        hooks: {
          setScale: [(u, key) => key === "x" && this.viewChanged(u)],
          drawClear: [(u) => drawAxisLines(u, color("--muted"))], // under the curves
        },
      },
      graphData(this.out.data),
      this.node,
    );
    // the legend's labels as math
    this.node.querySelectorAll(".u-legend .u-series:not(:first-child) .u-label").forEach((label, i) => {
      if (this.out.labels?.[i]) tex(label, this.out.labels[i], false);
    });
    this.plot.over.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    // uPlot's drag selects a range to zoom into: only with Shift; a plain drag pans. It reads
    // drag.x as the mouse moves, so this capturing listener decides it at each press
    this.node.addEventListener("mousedown", (e) => (this.plot.cursor.drag.x = e.shiftKey), true);
    this.plot.over.addEventListener("mousedown", (e) => this.dragToPan(e));
    this.touchToMove();
    this.node.dispatchEvent(new Event("drawn")); // its height is known now (the tape scrolls to it)
    new ResizeObserver(() => {
      const w = this.width();
      if (this.plot && w && w !== this.plot.width) this.plot.setSize({ width: w, height: this.height(w) });
    }).observe(this.node);
  }

  // the node's width inside its padding: what the plot can take
  width() {
    const style = getComputedStyle(this.node);
    return Math.floor(this.node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
  }

  height(width) {
    // the calculator's tape is short: the graph fits in it, legend and all
    return Math.round(Math.max(110, Math.min(tapeEl.clientHeight - 60, width * 0.55)));
  }

  destroy() {
    clearTimeout(this.timer);
    this.plot?.destroy();
    this.plot = null;
  }

  // --- moving the view ---

  view(plot = this.plot) {
    const { min, max } = plot.scales.x;
    return [min, max];
  }

  setView(min, max) {
    if (this.plot && max > min) this.plot.setScale("x", { min, max });
  }

  pan(direction) {
    if (!this.plot) return;
    const [min, max] = this.view();
    const step = (max - min) * 0.2 * direction;
    this.setView(min + step, max + step);
  }

  zoom(factor, at = null) {
    if (!this.plot) return;
    const [min, max] = this.view();
    const center = at ?? (min + max) / 2;
    this.setView(center - (center - min) * factor, center + (max - center) * factor);
  }

  reset() {
    if (!this.plot) return;
    clearTimeout(this.timer);
    this.seq++; // a resample still on its way is for another view
    this.y = this.out.data.y;
    this.shown = [this.out.data.x[0], this.out.data.x[1]];
    this.plot.setData(graphData(this.out.data));
  }

  // x per CSS pixel at the current zoom
  perPixel() {
    const [min, max] = this.view();
    return (max - min) / this.plot.over.clientWidth;
  }

  dragToPan(e) {
    if (e.button !== 0 || e.shiftKey) return;
    e.preventDefault(); // no text selection while dragging
    const [min, max] = this.view();
    const perPixel = this.perPixel();
    const startX = e.clientX;
    this.node.classList.add("panning");
    const move = (ev) => {
      const shift = (ev.clientX - startX) * perPixel;
      this.setView(min - shift, max - shift);
    };
    const up = () => {
      this.node.classList.remove("panning");
      document.removeEventListener("mousemove", move);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up, { once: true });
  }

  // Fingers on a touch screen: one drags the view sideways, two pinch it (and drag it):
  // the x values under the fingers when they came down stay under them. Upright drags
  // scroll the tape (touch-action: pan-y in touch.css), and the browser cancels ours.
  touchToMove() {
    const over = this.plot.over;
    const fingers = new Map(); // pointerId -> clientX, now
    let start = null; // the view, and where the fingers were, when the last one came or went
    const begin = () => (start = { view: this.view(), at: new Map(fingers) });
    over.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      fingers.set(e.pointerId, e.clientX);
      over.setPointerCapture(e.pointerId);
      begin();
    });
    over.addEventListener("pointermove", (e) => {
      if (!fingers.has(e.pointerId)) return;
      fingers.set(e.pointerId, e.clientX);
      const ids = [...start.at.keys()];
      const [min, max] = start.view;
      const perPixel = (max - min) / over.clientWidth;
      const left = over.getBoundingClientRect().left;
      const value = (x) => min + (x - left) * perPixel; // at the start
      if (ids.length === 1) {
        const shift = (fingers.get(ids[0]) - start.at.get(ids[0])) * perPixel;
        this.setView(min - shift, max - shift);
      } else {
        const [a, b] = ids;
        const apart = fingers.get(a) - fingers.get(b);
        if (Math.abs(apart) < 20 || Math.abs(start.at.get(a) - start.at.get(b)) < 20) return;
        const per = (value(start.at.get(a)) - value(start.at.get(b))) / apart;
        const from = value(start.at.get(a)) - (fingers.get(a) - left) * per;
        this.setView(from, from + over.clientWidth * per);
      }
    });
    const end = (e) => fingers.delete(e.pointerId) && begin();
    over.addEventListener("pointerup", end);
    over.addEventListener("pointercancel", end);
  }

  // A pinch on a trackpad arrives as Ctrl+wheel, and zooms; a sideways swipe (or
  // Shift+wheel) pans; a plain wheel scrolls the tape as usual
  wheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.01), this.plot.posToVal(e.offsetX, "x"));
      return;
    }
    const sideways = e.shiftKey ? e.deltaX || e.deltaY : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
    if (!sideways) return;
    e.preventDefault();
    const [min, max] = this.view();
    const shift = sideways * this.perPixel();
    this.setView(min + shift, max + shift);
  }

  // --- samples for the new view ---

  viewChanged(plot) {
    const [min, max] = this.view(plot);
    const [from, to] = this.shown;
    const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(to - from));
    if (close(min, from) && close(max, to)) return; // the samples already are for this view
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.send({ type: "sample", key: this.key, seq: ++this.seq, exprs: this.out.exprs, variable: this.out.var, xmin: min, xmax: max });
    }, RESAMPLE_MS);
  }

  samples(msg) {
    if (msg.seq !== this.seq || !this.plot || !msg.data) return; // stale, or failed: keep what's shown
    this.y = msg.data.y;
    this.shown = [msg.data.x[0], msg.data.x[1]];
    this.plot.setData(graphData(msg.data));
  }
}

// x = 0 and y = 0 themselves, where the grid alone wouldn't say where zero is. Drawn in
// canvas pixels (uPlot's bbox), and only when zero is in view
function drawAxisLines(u, stroke) {
  const { left, top, width, height } = u.bbox;
  const ctx = u.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, Math.round(devicePixelRatio || 1));
  const x0 = Math.round(u.valToPos(0, "x", true));
  if (x0 >= left && x0 <= left + width) {
    ctx.moveTo(x0, top);
    ctx.lineTo(x0, top + height);
  }
  const y0 = Math.round(u.valToPos(0, "y", true));
  if (y0 >= top && y0 <= top + height) {
    ctx.moveTo(left, y0);
    ctx.lineTo(left + width, y0);
  }
  ctx.stroke();
  ctx.restore();
}

// The tape's node for a graph output; drawn once uPlot has loaded
function renderGraph(entryId, out, send) {
  const node = document.createElement("div");
  node.className = "item graph";
  node.dataset.id = entryId;
  node.dataset.part = "graph";
  graphs.get(entryId)?.destroy();
  const graph = new Graph(node, entryId, out, send);
  graphs.set(entryId, graph);
  requestAnimationFrame(() =>
    graph.draw().catch((e) => {
      node.textContent = `Couldn't draw the graph: ${e.message}`;
    }),
  );
  return node;
}

function graphSamples(msg) {
  graphs.get(msg.key)?.samples(msg);
}

// keys for a graph selected on the tape; true if the key was one of them
function graphKey(entryId, key) {
  const graph = graphs.get(entryId);
  const action = {
    ArrowLeft: () => graph.pan(-1),
    ArrowRight: () => graph.pan(1),
    "+": () => graph.zoom(0.8),
    "=": () => graph.zoom(0.8), // + without Shift
    "-": () => graph.zoom(1.25),
    0: () => graph.reset(),
  }[key];
  if (!graph || !action) return false;
  action();
  return true;
}

function destroyGraphs() {
  for (const graph of graphs.values()) graph.destroy();
  graphs.clear();
}
