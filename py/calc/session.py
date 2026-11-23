"""
The calculator's Python side: one namespace, evaluated one submission at a time.

In the browser it runs inside Pyodide in a Web Worker (see worker.js), which calls
the Session methods and passes their JSON-able results to the page. It is plain
Python with no browser dependencies, so it also runs (and is tested) natively.
"""
import ast
import base64
import contextlib
import copy
import functools
import importlib
import io
import os
import pickle
import re
import sys
import types
import warnings
from numbers import Number
from tokenize import TokenError

from sympy import Basic, Eq, Float, Function, Integer, Lambda, NumberSymbol, Rational, Symbol, pi, sstr
from sympy.matrices import MatrixBase
from sympy.printing.latex import LatexPrinter

from . import docs, stats
from .catalog import catalog_entries
from .graphs import Graph, iplot, sample_text
from .matrices import MAKERS, matrix_text
from .parser import _GLOBALS, REFS_NAME, classify, is_statement, parse, to_python
from .preview import _symbol, preview

FLOAT_DIGITS = 15
PLOT_FUNCTIONS = ("plot", "plot_parametric", "plot_implicit", "plot3d")


class _LazyModule:
    """
    matplotlib.pyplot as `plt`, for plotting data: plt.plot([1, 2, 3], [1, 4, 9]).

    It stands in for the module until something is asked of it, since importing
    matplotlib costs ~13 MB in the browser and most sessions never plot (worker.js
    loads the package as soon as `plt` or `plot` appears in the input, so by then it
    is usually there). It lives in the session's namespace, not in _GLOBALS: see
    MAKERS below.
    """

    def __init__(self, name):
        self._name = name

    def __getattr__(self, attr):
        return getattr(importlib.import_module(self._name), attr)

    def __repr__(self):
        return f"<{self._name}>"

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


# sympy puts a \cdot between two numbers only if the next factor starts with a digit or a numeric
# fraction, so 0.5 * 2.0**x came out as "0.5 {2.0}^{x}", which reads as 0.52.0^x: let a power's
# opening braces through
_sympy_latex = importlib.import_module("sympy.printing.latex")  # not sympy.printing.latex: that's the function
_sympy_latex._between_two_numbers_p = (
    _sympy_latex._between_two_numbers_p[0],
    re.compile(r"(\{*\d|\\frac{\d+}{\d+})"),
)


class _LatexPrinter(LatexPrinter):
    """sympy's LaTeX, but names print like the preview prints them: velocity and x2 upright
    as one word (sympy writes them as italic letters, which reads as a product, and x2 as
    x with subscript 2, which reads back as x_2)."""

    def _print_Symbol(self, expr, style="plain"):
        return _symbol(expr.name)


def latex(expr, **settings):
    return _LatexPrinter(settings).doprint(expr)


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
        self.ns["help"] = docs.help  # SymPy's docstrings, which the browser's bundle leaves out
        self.ns["iplot"] = iplot
        self.ns["plt"] = _LazyModule("matplotlib.pyplot")  # plt.plot(xs, ys): data, not expressions
        self.ns.update(MAKERS)  # M[1, 2], V[1, 2]; here, not only in _GLOBALS, or the parser makes M a Symbol
        for name in PLOT_FUNCTIONS:
            if name in self.ns:
                self.ns[name] = _unlabeled(self.ns[name])
        self.base = dict(self.ns)  # what forget() restores a shadowed name to
        if state:
            self._restore(state)

    # --- the page's requests ------------------------------------------------

    def run(self, src, entry_id):
        """Evaluate one submission: {input_latex, outputs, result?, error?, names}."""
        payload = {"input_latex": self.preview(src)}  # before evaluating: what was typed, with the names known then
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
            if isinstance(outcome.value, Graph):
                payload["outputs"].append(outcome.value.output(latex))
                outcome.value = None  # the graph is the output
            elif _is_plot(outcome.value):
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

    def sample(self, exprs, var, xmin, xmax):
        """New samples for an iplot graph's x range, as the page zooms and pans."""
        return sample_text(exprs, var, xmin, xmax)

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

    def pickled(self, name):
        """A defined name's value, pickled (base64), so forgetting it can be undone; None
        if it isn't defined or doesn't pickle."""
        if name not in self.defined or name not in self.ns:
            return None
        try:
            return base64.b64encode(pickle.dumps(self.ns[name])).decode()
        except Exception:
            return None

    def unforget(self, name, data):
        """Undo forget(): define `name` again with the value pickled() returned."""
        self._assign(name, pickle.loads(base64.b64decode(data)))
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
        if is_statement(src):  # def f(x): y = x + 1; return y
            return Outcome(_exec_python(ast.parse(src), self.ns))
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
        if kind == "setitem":
            name, target, rhs = data
            if name not in ns:
                raise NameError(f"name '{name}' is not defined")
            value = parse(rhs, ns)
            # change a copy and make that the variable: whatever else holds the old value
            # (an earlier entry's $n) keeps it, as on a calculator
            changed = copy.deepcopy(ns[name])
            exec(f"{to_python(target, ns)} = _calc_value", _GLOBALS, {**ns, name: changed, "_calc_value": value})
            self._assign(name, changed)
            return Outcome(changed, label=latex(Symbol(name)))
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
            if items := _items(value):
                result["items"] = items
            if _worth_approximating(value):
                try:
                    approx = _evalf(value)
                    result["float"] = {"latex": latex(approx, full_prec=False), "text": _text(approx, full_prec=False)}
                    if _shows_exactly(value, approx):
                        result["float"]["exact"] = True  # 1/2 -> 0.5 is "=", 1/3 -> 0.333… is "≈"
                    if items := _items(approx, full_prec=False):
                        result["float"]["items"] = items
                except Exception:
                    pass
            if degrees := _degrees(value):
                result["degrees"] = degrees
            return result
        rendered = None
        if not isinstance(value, type):  # a class's _repr_latex_ is unbound: type(100) is Integer
            try:
                rendered = getattr(value, "_repr_latex_", lambda: None)()
            except Exception:
                pass
        if rendered:
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


def warm_up_plotting():
    """Draw a throwaway plot, so the first real one doesn't pay for the imports and setup."""
    import matplotlib.pyplot as plt
    from sympy import plot

    plot(Symbol("t"), show=False).save(io.BytesIO())
    plt.close("all")


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
    # what plt.plot returns is a plain list of matplotlib artists; the figure is the output
    if isinstance(value, (list, tuple)):
        return bool(value) and all(_is_plot(item) for item in value)
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


def _shows_exactly(value, approx):
    """Whether the float view's digits, as printed, are the value itself (1/2 -> 0.5, not 1/3 -> 0.333…)."""
    if isinstance(value, (list, tuple, set, frozenset)):
        return all(_shows_exactly(v, a) for v, a in zip(value, approx))
    if isinstance(value, dict):
        return _shows_exactly(list(value.items()), list(approx.items()))
    if not isinstance(value, (Basic, MatrixBase)):
        return True
    shown = {f: Rational(sstr(f, full_prec=False)) for f in approx.atoms(Float)}
    return approx.xreplace(shown) == value


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


BRACKETS = {list: ("[", "]"), tuple: ("(", ")"), set: (r"\{", r"\}"), frozenset: (r"\{", r"\}"), dict: (r"\{", r"\}")}


def _items(value, **settings):
    """A collection's elements as separate LaTeX pieces, so the page can wrap a long list
    like text (as one LaTeX expression it can only overflow): {open, close, items}."""
    brackets = BRACKETS.get(type(value))
    if brackets is None or len(value) < 2:
        return None
    if isinstance(value, dict):
        items = [f"{latex(k, **settings)} : {latex(v, **settings)}" for k, v in value.items()]
    else:
        items = [latex(v, **settings) for v in value]
    return {"open": brackets[0], "close": brackets[1], "items": items}


def _degrees(value):
    """The value read as an angle in radians, in degrees: pi/4 -> 45°. Only for real numbers."""
    if not isinstance(value, Basic) or isinstance(value, bool) or not value.is_number or value.is_real is not True:
        return None
    degrees = value * 180 / pi  # no simplify(): pi multiples cancel on their own, and it was most of a run's time
    if not degrees.is_Rational:
        degrees = degrees.evalf(FLOAT_DIGITS)
    text = sstr(degrees, full_prec=False)
    return {"latex": f"{latex(degrees, full_prec=False)}^{{\\circ}}", "text": f"{text}°"}


def _text(value, **settings):
    """Single-line source for a value, so picking it can paste it back into the input."""
    if isinstance(value, MatrixBase):
        return matrix_text(value, lambda v: _text(v, **settings))
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
