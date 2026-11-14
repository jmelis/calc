import pytest
from sympy import Eq, Integer, Lambda, Mul, Rational, pi, sin, sqrt, symbols

from calc.parser import _GLOBALS, classify, parse, rewrite_degrees, rewrite_inner_equations

x, y = symbols("x y")


@pytest.fixture
def ns():
    namespace = dict(_GLOBALS)
    namespace.update(x=x, y=y, ab=Integer(2), f=Lambda(x, x**2), ans=Eq(x**2, 4), _calc_out={3: Integer(5)})
    return namespace


@pytest.mark.parametrize(
    "src, expected",
    [
        ("2x + 3y", 2 * x + 3 * y),
        ("x^2", x**2),
        ("5!", Integer(120)),
        ("sin x^2", sin(x**2)),  # sympy's own implicit application fails here once x is defined
        ("sin^2 x", sin(x) ** 2),
        ("1/3 + 1/6", Rational(1, 2)),
        ("abs(-3)", Integer(3)),  # builtins aren't split into a*b*s
        ("int(3.7)", Integer(3)),
        ("ab x", 2 * x),  # defined names stay whole
        ("f x", x**2),
        ("$3 * 2", Integer(10)),
        ("solve(ans, x)", [-2, 2]),  # ans holds an Eq: the tokenizer mustn't bool() it
        ("sqrt(8)", 2 * sqrt(2)),
        ("sin(30°)", Rational(1, 2)),
        ("sin(30º)", Rational(1, 2)),  # º, the look-alike on Option+0
        ("atan(1)/1°", Integer(45)),  # ° binds tighter than /
        ("cos(60°) + -30°", Rational(1, 2) - pi / 6),
    ],
)
def test_parse(ns, src, expected):
    assert parse(src, ns) == expected


@pytest.mark.parametrize(
    "src, expected",
    [
        ("x + 1", ("expr", "x + 1")),
        ("a = 3", ("assign", (["a"], " 3"))),
        ("a := 3", ("assign", (["a"], " 3"))),
        ("a, b = 1, 2", ("assign", (["a", "b"], " 1, 2"))),
        ("f(x, y) = x + y", ("define", ("f", ["x", "y"], " x + y"))),
        ("x^2 = 4", ("equation", ("x^2 ", " 4"))),
        ("x == 2", ("expr", "x == 2")),
        ("solve(x, dict=True)", ("expr", "solve(x, dict=True)")),
    ],
)
def test_classify(src, expected):
    assert classify(src) == expected


@pytest.mark.parametrize(
    "src, expected",
    [
        ("solve(x^2 = 2, x)", "solve(Eq(x^2 ,  2), x)"),
        ("solve(x^2-4, x, dict=True)", "solve(x^2-4, x, dict=True)"),
        ('g("a=b")', 'g("a=b")'),
        ("solve((x", "solve((x"),  # unbalanced: left for the parser to report
    ],
)
def test_rewrite_inner_equations(src, expected):
    assert rewrite_inner_equations(src) == expected


@pytest.mark.parametrize(
    "src, expected",
    [
        ("30°", "(30*_deg)"),
        ("atan(1)/1°", "atan(1)/(1*_deg)"),
        ("(x+1)°", "((x+1)*_deg)"),
        ("sin(x)° + 2", "(sin(x)*_deg) + 2"),
    ],
)
def test_rewrite_degrees(src, expected):
    assert rewrite_degrees(src) == expected


def test_degree_needs_a_value():
    with pytest.raises(SyntaxError):
        rewrite_degrees("° + 1")


def test_undefined_names_split_into_letters(ns):
    assert parse("velocity", ns) == Mul(*symbols("v e l o c i t y"))
