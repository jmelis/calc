"""
Random expressions, typeset and read back: what the page shows must be what the calculator
evaluates. Text -> preview LaTeX -> latexToCalc -> text must have the same value as the
original (at two points, for the free symbols), and so must sympy's LaTeX for a result, in
the exact and the decimal view. It catches a dropped parenthesis, a minus that turns a product
into a subtraction, wrong grouping in an exponent. It can't see numbers run together
(3 {2}^{3} reads back as 3 * 2^3, but a reader sees 32^3): test_preview.py has those cases.
Needs node, like test_latex.py.
"""
import random
import shutil
import signal

import pytest
from sympy import N

from calc import session
from calc.preview import preview
from test_latex import evaluate, to_calc

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

ATOMS = ["2", "3", "7", "10", "0.5", "1.5", "x", "y", "pi", "e", "ab", "2x", "x y", "1/2", "3/4", "5!", "x_1"]
BINOPS = ["+", "-", "*", "/", "^", "*-", "^-", " ", "**"]
FUNCS = ["sin", "cos", "sqrt", "exp", "log", "abs", "f"]
POINTS = [{"x": 1.3, "y": 0.7, "k": 1.1, "n": 2.5}, {"x": 2.1, "y": 1.9, "k": 0.6, "n": 1.2}]
OPERATORS = "+-*/^ "


def generate(rng, depth=0):
    if depth > 3 or rng.random() < 0.25:
        return rng.choice(ATOMS)
    r = rng.random()
    if r < 0.55:
        a, b = generate(rng, depth + 1), generate(rng, depth + 1)
        # a sub-expression is often grouped: that is where a dropped parenthesis shows
        if rng.random() < 0.5 and any(c in a for c in OPERATORS):
            a = f"({a})"
        if rng.random() < 0.5 and any(c in b for c in OPERATORS):
            b = f"({b})"
        return a + rng.choice(BINOPS) + b
    if r < 0.65:
        return f"({generate(rng, depth + 1)})"
    if r < 0.72:
        return "-" + generate(rng, depth + 1)
    if r < 0.78:
        return rng.choice(FUNCS) + " " + rng.choice(["x", "x^2", "2x", "(x+1)", "3"])
    if r < 0.80:
        return f"({generate(rng, depth + 1)})°"
    return f"{rng.choice(FUNCS)}({generate(rng, depth + 1)})"
    # no (…)!: "x y!" is (x y)! to the calculator, which is its own matter


class Slow(Exception):
    pass


def _alarm(*_):
    raise Slow


def timed(fn, *args, seconds=3):
    signal.signal(signal.SIGALRM, _alarm)
    signal.alarm(seconds)
    try:
        return fn(*args)
    finally:
        signal.alarm(0)


def values(a, b):
    """True/False when a and b are the same number at every point, None when it can't tell."""
    if a == b:
        return True
    for point in POINTS:
        try:
            p, q = (
                complex(N(v.subs({s: point[str(s)] for s in v.free_symbols if str(s) in point}), 12))
                for v in (a, b)
            )
        except Exception:
            return None
        if p != p or q != q:
            return None
        if abs(p - q) > 1e-7 * max(1, abs(p), abs(q)):
            return False
    return True


def cases(seed, view, count):
    rng = random.Random(seed)
    out = []
    while len(out) < count:
        src = generate(rng)
        if "--" in src:  # the keypad's: --5 continues ans
            continue
        try:
            value = timed(evaluate, src)
            if view == "input":
                latex = preview(src, ["ab"], ["f"])
            elif view == "result":
                latex = session.latex(value)
            else:
                latex = session.latex(session._evalf(value), full_prec=False)
        except BaseException:
            continue
        out.append((src, latex, value))
    return out


@pytest.mark.parametrize("seed, view", [(1, "input"), (2, "input"), (3, "result"), (4, "float")])
def test_typeset_reads_back_as_the_same_value(seed, view):
    found = cases(seed, view, 150)
    problems = []
    for (src, latex, value), text in zip(found, to_calc([c[1] for c in found])):
        if isinstance(text, dict):
            problems.append(f"{src!r}: {latex} -> {text}")
            continue
        try:
            same = timed(lambda: values(value, evaluate(text)))
        except BaseException:
            same = None
        if same is False:
            problems.append(f"{src!r}: {latex} -> {text}")
    assert not problems, "\n".join(problems[:10])
