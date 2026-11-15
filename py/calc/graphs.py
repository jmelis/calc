"""
iplot: interactive graphs. Python samples the functions with numpy; the page draws
them (graph.js, with uPlot) and asks for new samples of whatever range is in view
when it's zoomed or panned (Session.sample, so no figure is kept here).

    iplot(sin(x))                       over -10..10
    iplot(sin(x), cos(x), (x, 0, 2pi))  several, over a range

numpy is imported only when sampling: in the browser it's loaded on the first iplot.
"""
import warnings

from sympy import Symbol, latex, lambdify, srepr, sstr, sympify
from sympy.core.sympify import SympifyError
from sympy.core.relational import Relational

SAMPLES = 800
DEFAULT_RANGE = (-10, 10)


class Graph:
    def __init__(self, exprs, var, xmin, xmax):
        self.exprs, self.var, self.xmin, self.xmax = exprs, var, xmin, xmax

    def output(self, latex=latex):
        """What the tape keeps: the expressions (srepr, to sample again later) and a first sampling."""
        return {
            "kind": "graph",
            "exprs": [srepr(e) for e in self.exprs],
            "labels": [latex(e) for e in self.exprs],
            "texts": [sstr(e) for e in self.exprs],
            "var": srepr(self.var),
            "var_name": self.var.name,
            "range": [self.xmin, self.xmax],
            "data": sample(self.exprs, self.var, self.xmin, self.xmax),
        }


def _is_range(arg):
    """
    [x, a, b]: a variable and two numbers, the range written with brackets.

    A list is otherwise the several-expressions form (iplot([f, g])), so it only counts
    as a range when it reads like one; a 3-tuple always does, as it does in sympy.
    """
    if not isinstance(arg, list) or len(arg) != 3:
        return False
    var, *bounds = arg
    try:
        return isinstance(sympify(var), Symbol) and all(sympify(b).is_number for b in bounds)
    except (SympifyError, TypeError):
        return False


def iplot(*args):
    """iplot(f, g, ..., (x, a, b) or [x, a, b]): the range is optional with one variable."""
    args = list(args)
    span = None
    if args and ((isinstance(args[-1], tuple) and len(args[-1]) == 3) or _is_range(args[-1])):
        span = args.pop()
    exprs = []
    for arg in args:
        exprs.extend(arg if isinstance(arg, list) else [arg])  # iplot([f, g]) works too
    if not exprs:
        raise TypeError("iplot needs something to draw: iplot(sin(x)), or iplot(f, g, (x, a, b))")
    exprs = [sympify(e) for e in exprs]
    if any(isinstance(e, Relational) for e in exprs):
        raise TypeError("iplot draws expressions, not equations: iplot(x^2 - 4)")
    free = set().union(*(e.free_symbols for e in exprs))
    if span:
        var = sympify(span[0])
        xmin, xmax = (float(sympify(v).evalf()) for v in span[1:])
    else:
        if len(free) > 1:
            names = ", ".join(sorted(map(str, free)))
            raise ValueError(f"iplot over which of {names}? Give a range: iplot(expr, (x, -5, 5))")
        var = free.pop() if free else Symbol("x")
        xmin, xmax = DEFAULT_RANGE
    if not isinstance(var, Symbol):
        raise TypeError("the range is (variable, from, to): (x, -5, 5)")
    others = free - {var}
    if others:
        names = ", ".join(sorted(map(str, others)))
        raise ValueError(f"{names} has no value: give it one, or plot over it")
    if not xmin < xmax:
        raise ValueError("the range goes from low to high: (x, -5, 5)")
    return Graph(exprs, var, xmin, xmax)


def sample(exprs, var, xmin, xmax, n=SAMPLES):
    """{x, ys, y}: n evenly spaced x from xmin to xmax (x is [xmin, xmax, n]), the values of
    each expression there (None where it isn't a real number, or jumps across a pole), and
    a y range that fits them."""
    import numpy as np

    xs = np.linspace(xmin, xmax, n)
    ys = [_values(e, var, xs) for e in exprs]
    return {"x": [xmin, xmax, n], "ys": [_json(y) for y in ys], "y": _y_range(ys)}


def warm_up_iplot():
    """Sample something once, so the first real iplot doesn't pay for importing numpy and lambdify's printer."""
    t = Symbol("t")
    sample([t**2], t, 0, 1, n=10)


def sample_text(exprs, var, xmin, xmax):
    """sample() of what Graph.output() stored, for the page's zooming."""
    return sample([sympify(e) for e in exprs], sympify(var), float(xmin), float(xmax))


def _values(expr, var, xs):
    import numpy as np

    with warnings.catch_warnings(), np.errstate(all="ignore"):
        warnings.simplefilter("ignore")
        try:
            values = lambdify(var, expr, "numpy")(xs)
        except Exception:
            # functions numpy doesn't have (gamma, zeta): point by point with mpmath
            f = lambdify(var, expr, "mpmath")
            values = np.array([_point(f, x) for x in xs])
        values = np.broadcast_to(np.asarray(values, dtype=complex), xs.shape)
        real = np.abs(values.imag) <= 1e-9 * np.maximum(1, np.abs(values.real))
        y = np.where(real, values.real, np.nan)
        y[~np.isfinite(y)] = np.nan
        # a pole (tan at pi/2): don't join the huge values on either side of it
        finite = y[np.isfinite(y)]
        if finite.size > 10:
            low, high = np.percentile(finite, [5, 95])
            jumps = (np.abs(np.diff(y)) > 4 * max(high - low, 1e-12)) & (np.sign(y[:-1]) != np.sign(y[1:]))
            y[1:][jumps] = np.nan
    return y


def _point(f, x):
    try:
        return complex(f(x))
    except Exception:
        return complex("nan")


def _y_range(ys):
    """Fits the values, but not the spikes near a pole (tan, 1/x), which would flatten the rest."""
    import numpy as np

    values = np.concatenate([y[np.isfinite(y)] for y in ys]) if ys else np.array([])
    if values.size == 0:
        return [-1.0, 1.0]
    low, high = float(values.min()), float(values.max())
    q_low, q_high = (float(q) for q in np.percentile(values, [5, 95]))
    if high - low > 10 * (q_high - q_low):
        low, high = q_low, q_high
    if high - low < 1e-12:
        return [low - 1, high + 1]
    margin = (high - low) * 0.05
    return [low - margin, high + margin]


def _json(y):
    # 7 digits are plenty for drawing, and half the size on the tape; NaN isn't JSON
    return [None if v != v else float(f"{v:.7g}") for v in y.tolist()]

