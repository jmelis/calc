import pytest
from sympy import Eq, Integer, Lambda, Rational, Symbol, pi, sin, sqrt, symbols

from calc.parser import _GLOBALS, UnknownFunctionError, classify, parse, rewrite_degrees, rewrite_inner_equations

from sympy import E as sympy_E

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
        ("solve(x^2 = 2, x)", "solve(Eq(x^2 , 2), x)"),
        ("solve([x + y = 3, x - y = 1], [x, y])", "solve([Eq(x + y , 3),Eq( x - y , 1)], [x, y])"),
        ("f(g(x + 1 = 1) = 2)", "f(Eq(g(Eq(x + 1 , 1)) , 2))"),  # nested
        ("g(x = 1)", "g(x = 1)"),  # a bare name before = is a keyword argument
        ("plot(x, xlabel = 'a=b', ylabel='')", "plot(x, xlabel = 'a=b', ylabel='')"),
        ("[a := 3]", "[a := 3]"),  # := inside brackets is Python's
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


@pytest.mark.parametrize(
    "src, expected",
    [
        ("xy", Symbol("xy")),  # one name, whether or not x and y are defined
        ("x y", x * y),
        ("x*y", x * y),
        ("2xy", 2 * Symbol("xy")),
        ("velocity", Symbol("velocity")),  # not v*e*l*o*c*i*t*y with e = 2.718…
        ("x2", Symbol("x2")),
    ],
)
def test_names_are_whole_words(ns, src, expected):
    ns.update(e=sympy_E)
    assert parse(src, ns) == expected


def test_a_defined_name_keeps_its_meaning(ns):
    ns.update(x=Integer(10), y=Integer(20))
    assert parse("xy", ns) == Symbol("xy")
    ns["xy"] = Integer(30)
    assert parse("xy", ns) == 30


def test_unknown_functions_are_errors_with_a_suggestion(ns):
    with pytest.raises(UnknownFunctionError, match="did you mean solve"):
        parse("slove(x^2 - 4, x)", ns)


def test_python_builtins(ns):
    assert parse("sorted([3, 1, 2])", ns) == [1, 2, 3]
    assert parse("type(100)", ns) is Integer
