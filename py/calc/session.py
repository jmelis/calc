"""
The calculator's Python side: one namespace, evaluated one submission at a time.

In the browser it runs inside Pyodide in a Web Worker (see worker.js), which calls
the Session methods and passes their JSON-able results to the page. It is plain
Python with no browser dependencies, so it also runs (and is tested) natively.
"""
import ast
import base64
import contextlib
import functools
import io
import os
import pickle
import sys
import types
import warnings
from numbers import Number
from tokenize import TokenError

from sympy import Basic, Eq, Float, Function, Integer, Lambda, NumberSymbol, Rational, Symbol, latex, pi, sstr
from sympy.matrices import MatrixBase

from . import stats
from .catalog import catalog_entries
from .parser import _GLOBALS, REFS_NAME, classify, parse
from .preview import preview

FLOAT_DIGITS = 15
PLOT_FUNCTIONS = ("plot", "plot_parametric", "plot_implicit", "plot3d")

# Figures are rendered to PNGs (see _figures); no window or browser canvas backend
os.environ.setdefault("MPLBACKEND", "Agg")

# Plain sympy, set up like isympy
INIT = """
from sympy import *
x, y, z, t = symbols('x y z t')
k, m, n = symbols('k m n', integer=True)
f, g, h = symbols('f g h', cls=Function)
e = E
"""


class Outcome:
    def __init__(self, value, label=None, text=None, set_ans=True):
        self.value = value
        self.label = label
        self.text = text
        self.set_ans = set_ans


class Session:
    def __init__(self, state=None):
        """`state` is what state() returned in an earlier session (variables, ans, $n)."""
        self.ns = {}
        exec(INIT, self.ns)
        self.out = {}  # entry id -> value, for $n
        self.defined = set()  # names assigned with a = …, f(x) = …
        self.ns[REFS_NAME] = self.out
        self.ns["ans"] = Integer(0)
        self.ns.update(stats.FUNCTIONS)
        for name in PLOT_FUNCTIONS:
            if name in self.ns:
                self.ns[name] = _unlabeled(self.ns[name])
        self.base = dict(self.ns)  # what forget() restores a shadowed name to
        if state:
            self._restore(state)

    # --- the page's requests ------------------------------------------------

    def run(self, src, entry_id):
        """Evaluate one submission: {input_latex, outputs, result?, error?, names}."""
        payload = {"input_latex": self.preview(src)}
        stdout = io.StringIO()
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stdout), warnings.catch_warnings():
                warnings.simplefilter("ignore")
                outcome = self._evaluate(src.strip())
        except Exception as e:
            outcome = None
            payload["error"] = f"{type(e).__name__}: {e}"
        payload["outputs"] = ([{"kind": "text", "text": stdout.getvalue()}] if stdout.getvalue() else []) + _figures()

        if outcome is not None:
            if _is_plot(outcome.value):
                outcome.value = None  # the figure is in outputs; the plot object's repr is noise
            if outcome.value is not None:
                self.out[entry_id] = outcome.value
                if outcome.set_ans:
                    self.ns["ans"] = outcome.value
                payload["result"] = self._describe(entry_id, outcome)
        payload["names"] = self.names()
        return payload

    def preview(self, src):
        """LaTeX for the input as typed, or None (Python statements, unfinished input)."""
        names = self.names()
        try:
            return preview(src, names["variables"], names["functions"])
        except Exception:
            return None

    def names(self):
        """Names defined beyond plain sympy: kept whole (ab isn't a*b) and offered for completion."""
        variables, functions = [], []
        for name, value in self.ns.items():
            if name.startswith("_") or _GLOBALS.get(name) is value or isinstance(value, types.ModuleType):
                continue
            is_function = callable(value) and not isinstance(value, (Basic, MatrixBase))
            (functions if is_function or isinstance(value, Lambda) else variables).append(name)
        defined = sorted(n for n in self.defined if n in self.ns)
        return {"variables": sorted(variables), "functions": sorted(functions), "defined": defined}

    def catalog(self):
        return catalog_entries()

    def variables(self):
        """What's defined (via a = …, f(x) = …) with current values, for the Memory panel."""
        items = []
        for name in ["ans", *sorted((n for n in self.defined if n in self.ns), key=str.lower)]:
            value = self.ns[name]
            if isinstance(value, Lambda):
                label = latex(Function(name)(*value.variables))
                body, kind = latex(value.expr), "function"
            else:
                label = r"\mathrm{ans}" if name == "ans" else latex(Symbol(name))
                body = latex(value) if _is_symbolic(value) else rf"\text{{{type(value).__name__}}}"
                kind = "last result" if name == "ans" else "variable"
            items.append({"name": name, "latex": f"{label} = {body}", "kind": kind})
        return items

    def forget(self, name):
        """Delete a variable defined in the calculator; a shadowed sympy name comes back."""
        if name in self.defined:
            self.defined.discard(name)
            self.ns.pop(name, None)
            if name in self.base:
                self.ns[name] = self.base[name]
        return self.variables()

    def state(self):
        """Variables, ans and $n values, pickled (what doesn't pickle is dropped)."""
        state = {
            "vars": _picklable((n, self.ns[n]) for n in self.defined if n in self.ns),
            "out": _picklable(self.out.items()),
            "ans": _picklable([("ans", self.ns.get("ans"))]).get("ans", Integer(0)),
        }
        return pickle.dumps(state)

    def _restore(self, state):
        try:
            state = pickle.loads(state)
        except Exception:
            return  # an unreadable save shouldn't stop the calculator from starting
        self.ns.update(state.get("vars", {}))
        self.defined.update(state.get("vars", {}))
        self.out.update(state.get("out", {}))
        if "ans" in state:
            self.ns["ans"] = state["ans"]

    # --- evaluation ------------------------------------------------------------

    def _evaluate(self, src):
        try:
            return self._evaluate_calc(src)
        except (SyntaxError, TokenError) as calc_error:
            # Not calculator syntax: run it as Python (statements, imports, loops)
            try:
                tree = ast.parse(src)
            except SyntaxError:
                raise calc_error from None
            return Outcome(_exec_python(tree, self.ns))

    def _evaluate_calc(self, src):
        ns = self.ns
        kind, data = classify(src)
        if kind == "expr":
            return Outcome(parse(data, ns))
        if kind == "equation":
            lhs, rhs = data
            return Outcome(Eq(parse(lhs, ns), parse(rhs, ns)))
        if kind == "assign":
            names, rhs = data
            value = parse(rhs, ns)
            values = [value] if len(names) == 1 else list(value)
            if len(values) != len(names):
                raise ValueError(f"expected {len(names)} values, got {len(values)}")
            for name, v in zip(names, values):
                self._assign(name, v)
            return Outcome(value, label=", ".join(latex(Symbol(n)) for n in names))
        name, args, body = data
        arg_syms = [Symbol(a) for a in args]
        fn = Lambda(tuple(arg_syms), parse(body, {**ns, **dict(zip(args, arg_syms))}))
        self._assign(name, fn)
        head = latex(Function(name)(*arg_syms))
        return Outcome(fn.expr, label=head, text=name, set_ans=False)

    def _assign(self, name, value):
        self.ns[name] = value
        self.defined.add(name)

    # --- describing results -------------------------------------------------------

    def _describe(self, entry_id, outcome):
        """
        How the page shows a result: exact LaTeX plus, when they say something new, a
        float and a degrees view; `text` is what's inserted when the result is picked.
        """
        value = outcome.value
        result = {"label": outcome.label}
        if _is_symbolic(value):
            result["latex"] = latex(value)
            result["text"] = outcome.text or _text(value)
            if _worth_approximating(value):
                try:
                    approx = _evalf(value)
                    result["float"] = {"latex": latex(approx, full_prec=False), "text": _text(approx, full_prec=False)}
                except Exception:
                    pass
            if degrees := _degrees(value):
                result["degrees"] = degrees
            return result
        repr_latex = getattr(value, "_repr_latex_", None)
        if callable(repr_latex) and (rendered := repr_latex()):
            result["latex"] = strip_math_delimiters(rendered)
        else:
            result["plain"] = repr(value)
        # Arbitrary objects don't round-trip through text; refer to the stored value
        result["text"] = outcome.text or f"${entry_id}"
        return result


def _exec_python(tree, ns):
    """exec a module, returning the value of its last line if it's an expression."""
    last = tree.body.pop() if tree.body and isinstance(tree.body[-1], ast.Expr) else None
    exec(compile(tree, "<calc>", "exec"), ns)
    if last is not None:
        return eval(compile(ast.Expression(last.value), "<calc>", "eval"), ns)
    return None


def _unlabeled(plot_fn):
    """
    sympy labels the axes "x" and "f(x)" by default, and with the axes crossing at the
    origin those labels sit on top of the tick numbers; leave them off unless asked for.
    """
    @functools.wraps(plot_fn)
    def wrapper(*args, **kwargs):
        if plot_fn.__name__ != "plot3d":
            kwargs.setdefault("xlabel", "")
            kwargs.setdefault("ylabel", "")
        return plot_fn(*args, **kwargs)

    return wrapper


def configure_matplotlib():
    """Readable plots; call once matplotlib is importable (in Pyodide it's loaded on first use)."""
    import matplotlib

    matplotlib.rcParams.update({"font.size": 13, "axes.labelsize": 14, "figure.figsize": (7, 4.5)})


def _figures():
    """Open matplotlib figures as PNG outputs (2x for sharp screens), then closed."""
    if "matplotlib.pyplot" not in sys.modules:
        return []  # nothing has plotted; don't pay for importing matplotlib
    import matplotlib.pyplot as plt

    outputs = []
    for number in plt.get_fignums():
        fig = plt.figure(number)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=fig.dpi * 2, bbox_inches="tight")
        width = fig.get_size_inches()[0] * fig.dpi
        outputs.append({"kind": "image", "png": base64.b64encode(buf.getvalue()).decode(), "width": round(width)})
    plt.close("all")
    return outputs


def _is_plot(value):
    module = type(value).__module__ or ""
    return module.startswith(("sympy.plotting", "matplotlib"))


def _is_symbolic(value):
    if isinstance(value, (Basic, MatrixBase, Number)):
        return True
    if isinstance(value, (list, tuple, set, frozenset)):
        return all(_is_symbolic(v) for v in value)
    if isinstance(value, dict):
        return all(_is_symbolic(k) and _is_symbolic(v) for k, v in value.items())
    return False


def _evalf(value):
    if isinstance(value, (bool, int, Integer)):
        return value
    if isinstance(value, Number):
        return Float(value, FLOAT_DIGITS)
    if isinstance(value, (list, tuple, set, frozenset)):
        return type(value)(_evalf(v) for v in value)
    if isinstance(value, dict):
        return {_evalf(k): _evalf(v) for k, v in value.items()}
    evalf = getattr(value, "evalf", None)
    return evalf(FLOAT_DIGITS) if evalf else value


def _worth_approximating(value):
    """Whether a float view says something the exact one doesn't (not for x**2 + 1 -> x**2 + 1.0)."""
    if isinstance(value, (list, tuple, set, frozenset)):
        return any(_worth_approximating(v) for v in value)
    if isinstance(value, dict):
        return any(_worth_approximating(v) for v in value.items())
    if not isinstance(value, (Basic, MatrixBase)):
        return False
    return (
        any(not r.is_Integer for r in value.atoms(Rational))
        or bool(value.atoms(NumberSymbol))
        or any(f.is_number for f in value.atoms(Function))
    )


def _degrees(value):
    """The value read as an angle in radians, in degrees: pi/4 -> 45°. Only for real numbers."""
    if not isinstance(value, Basic) or isinstance(value, bool) or not value.is_number or value.is_real is not True:
        return None
    degrees = (value * 180 / pi).simplify()
    if not degrees.is_Rational:
        degrees = degrees.evalf(FLOAT_DIGITS)
    text = sstr(degrees, full_prec=False)
    return {"latex": f"{latex(degrees, full_prec=False)}^{{\\circ}}", "text": f"{text}°"}


def _text(value, **settings):
    """Single-line source for a value, so picking it can paste it back into the input."""
    if isinstance(value, MatrixBase):
        return f"Matrix({_text(value.tolist(), **settings)})"
    if isinstance(value, list):
        return "[" + ", ".join(_text(v, **settings) for v in value) + "]"
    if isinstance(value, tuple):
        inner = ", ".join(_text(v, **settings) for v in value)
        return f"({inner},)" if len(value) == 1 else f"({inner})"
    if isinstance(value, dict):
        return "{" + ", ".join(f"{_text(k, **settings)}: {_text(v, **settings)}" for k, v in value.items()) + "}"
    if isinstance(value, (set, frozenset)):
        return "{" + ", ".join(_text(v, **settings) for v in value) + "}" if value else "set()"
    return sstr(value, **settings)


def strip_math_delimiters(s):
    s = s.strip()
    for delim in ("$$", "$"):
        if s.startswith(delim) and s.endswith(delim) and len(s) > 2 * len(delim):
            return s[len(delim):-len(delim)].strip()
    return s


def _picklable(items):
    kept = {}
    for key, value in items:
        try:
            pickle.dumps(value)
        except Exception:
            continue
        kept[key] = value
    return kept
