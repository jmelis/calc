"""
latex.js (math input -> calculator syntax), checked by round trip through sympy:
text -> preview LaTeX -> latexToCalc -> text must evaluate to the same thing, and so
must sympy's own LaTeX for results picked from the tape. Needs node.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from sympy import (
    E, Abs, Eq, Float, I, Lambda, Matrix, Piecewise, Rational, atan, binomial, cos, exp, factorial, latex, log, oo,
    Symbol, pi, simplify, sin, sinh, sqrt, symbols, zoo,
)

from calc.parser import _GLOBALS, classify, parse
from calc.preview import preview

ROOT = Path(__file__).resolve().parent.parent
x, y, z, k, n = symbols("x y z k n")
pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")

NS = dict(_GLOBALS)
NS.update(x=x, y=y, z=z, k=k, n=n, e=E, ans=7, ab=2, f=Lambda(x, x**2), _calc_out={3: 5})

INPUTS = [
    "x^2 + 1/x", "solve(x^2 = 2, x)", "integrate(sin(x)^2, x)", "integrate(x^2, (x, 0, 1))",
    "diff(sin x, x)", "diff(x^3, x, 2)", "diff(x^2 y, x, y)", "limit(sin(x)/x, x, 0)",
    'limit(1/x, x, 0, "+")', "summation(1/k^2, (k, 1, oo))", "$3 * 2 + ans", "a = 3/7 + 1/5",
    "f(x, y) = x^2 + y", "Matrix([[1,2],[3,4]])", "abs(-3)", "log(8, 2)", "root(27, 3)", "exp(x)",
    "5!", "(n+1)!", "x <= 3", "theta_1 + alpha", "[1, 2/3]", "sqrt(2) + pi", "E^(I pi)",
    "2x + 3y", "sin x^2", "sin(x)^2", "(x+1)^2", "-x^2", "x - (1 + 2)", "x*-3", "f(2)", "ab x",
    "factor(x^2 - 5x + 6)", "Matrix([[1,2],[3,4]]).det()", "cos(x)^2 + sin(x)^2", "1/(1+1/x)",
    "x^(1/2)", "2^3^2", "gamma(5)", "asin(1/2)", "max(1, 2)", "nsolve(cos(x) - x, x, 1)",
    "product(k, (k, 1, 5))", "3.5 * 2", "exp(1)", "x^2 = 4", "sin(30°)", "binomial(5, 2)",
]
RESULTS = [
    Rational(22, 35), 22 * sqrt(2) / 35, [-sqrt(2), sqrt(2)], x**2 * cos(x) + 2 * x * sin(x),
    Matrix([[-2, 1], [Rational(3, 2), -Rational(1, 2)]]), x / 2 - sin(x) * cos(x) / 2, (x - 1) * exp(x),
    pi / 2, 2 * I, Float("1.5707963267949"), sqrt(2) / 2 + I * sqrt(2) / 2, log(x), exp(x**2), Abs(x),
    atan(x), sinh(x) ** 2, factorial(n), binomial(n, k), {x: -sqrt(2)}, oo, -oo, zoo, x ** Rational(1, 3),
    Eq(x**2, 4), (x, 2), Matrix([1, 2, 3]), Piecewise((x, x > 0), (0, True)),
]
# what MathLive itself writes for typed input, and the calculator text it should become
MATHLIVE = {
    r"\frac37+\frac15": "(3/7) + (1/5)",
    r"solve\left(x^2=2,x\right)": "solve(x^2 = 2, x)",
    r"sin\,x+2\,x": "sin x + 2 x",
    r"\int_0^1x^2\,\mathrm{d}x": "integrate(x^2, (x, 0, 1))",
    r"\int xdx": "integrate(x, x)",
    r"\frac{\mathrm{d}}{\mathrm{d}x}\left(x^3\right)": "diff((x^3), x)",
    r"\lim_{x\to0^{+}}\frac{1}{x}": 'limit((1/x), x, 0, "+")',
    r"\#3\cdot2": "$3*2",
    r"\operatorname{\mathrm{factor}}\left(x^2-1\right)": "factor(x^2 - 1)",
    r"a:=10": "a = 10",
    r"\binom52": "binomial(5, 2)",
    r"\sin\left(30^{\circ}\right)": "sin(30°)",
    r"\cos^2x+\sin^2x": "cos(x)^2 + sin(x)^2",
}


def evaluate(src):
    kind, data = classify(src)
    if kind == "expr":
        return parse(data, dict(NS))
    if kind == "equation":
        return Eq(parse(data[0], dict(NS)), parse(data[1], dict(NS)))
    if kind == "assign":
        return ("assign", tuple(data[0]), parse(data[1], dict(NS)))
    name, args, body = data
    syms = [Symbol(a) for a in args]
    return ("define", name, Lambda(tuple(syms), parse(body, {**NS, **dict(zip(args, syms))})))


def same(a, b):
    if isinstance(a, tuple) and isinstance(b, tuple):
        return len(a) == len(b) and all(same(p, q) for p, q in zip(a, b))
    if isinstance(a, (list, dict)) or isinstance(b, (list, dict)):
        return a == b
    return a == b or simplify(a - b) == 0


def to_calc(latexes):
    script = (
        f"const {{ latexToCalc }} = require({json.dumps(str(ROOT / 'latex.js'))});"
        "const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "console.log(JSON.stringify(input.map((l) => { try { return latexToCalc(l); } catch (e) { return {error: e.message}; } })));"
    )
    out = subprocess.run(["node", "-e", script], input=json.dumps(latexes), capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


CASES = [(f"input {src}", preview(src, ["ab"], ["f"]), evaluate(src)) for src in INPUTS]
CASES += [(f"result {value}", latex(value), value) for value in RESULTS]
CONVERTED = dict(zip((c[0] for c in CASES), to_calc([c[1] for c in CASES]))) if shutil.which("node") else {}


@pytest.mark.parametrize("label, source, expected", CASES, ids=[c[0] for c in CASES])
def test_round_trip(label, source, expected):
    text = CONVERTED[label]
    assert not isinstance(text, dict), f"{source}: {text}"
    assert same(evaluate(text), expected), f"{source} -> {text}"


def test_mathlive_input():
    assert dict(zip(MATHLIVE, to_calc(list(MATHLIVE)))) == MATHLIVE


def test_empty_boxes_are_reported():
    [result] = to_calc([r"\frac{x}{\placeholder{}}"])
    assert result == {"error": "fill in the empty boxes first"}
