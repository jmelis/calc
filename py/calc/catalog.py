"""
Function catalog shown by the calculator's `?` popup.

A curated list of SymPy functions: all of SymPy would be thousands of names, mostly
noise. The page adds "Your definitions" (names defined in the session) on top.
"""

# (name, signature, summary, example)
SYMPY = {
    "Calculator": [
        ("ans", "", "The last result", "ans^2"),
        ("x y", "", "A space or * multiplies; xy is a single name, like velocity or x2", "x y"),
        ("$n", "", "The result of tape entry n (insert one by picking it with ↑)", "$3 + 1"),
        ("a = …", "", "Assign a variable", "a = 3/7"),
        ("f(x) = …", "", "Define a function", "f(x) = x^2 + 1"),
        ("lhs = rhs", "", "Anything else with = is an equation", "x^2 = 4"),
        (":help", "", "How to type things: syntax, vectors and matrices, Python, keys", ":help"),
        (":catalog", "", "This list of functions: search it, see an example, insert one", ":catalog"),
        (":vars", "", "Memory: what's defined, with values; ⌫ forgets one (⌃Z undoes)", ":vars"),
        (":clear", "", "Clear the tape (variables are kept; ⌃Z undoes)", ":clear"),
        (":reset", "", "Clear the tape and forget all variables", ":reset"),
    ],
    "Algebra": [
        ("simplify", "(expr)", "Simplify an expression", "simplify(sin(x)^2 + cos(x)^2)"),
        ("expand", "(expr)", "Expand products and powers", "expand((x + 1)^3)"),
        ("factor", "(expr)", "Factor a polynomial", "factor(x^2 - 5x + 6)"),
        ("cancel", "(expr)", "Cancel common factors of a rational function", "cancel((x^2 - 1)/(x - 1))"),
        ("apart", "(expr, x)", "Partial fraction decomposition", "apart(1/(x^2 - 1), x)"),
        ("together", "(expr)", "Combine into a single fraction", "together(1/x + 1/y)"),
        ("collect", "(expr, x)", "Collect powers of x", "collect(a x + b x + c, x)"),
        ("subs", "expr.subs(x, value)", "Substitute a value", "(x^2 + 1).subs(x, 3)"),
        ("trigsimp", "(expr)", "Simplify trigonometric expressions", "trigsimp(2 sin(x) cos(x))"),
        ("expand_trig", "(expr)", "Expand trig functions of sums/multiples", "expand_trig(sin(2x))"),
        ("nsimplify", "(number)", "Find a simple exact form for a float", "nsimplify(0.333333333)"),
    ],
    "Equations": [
        ("solve", "(expr, x)", "Solve expr = 0 (or an Eq) for x", "solve(x^2 - 4, x)"),
        ("solveset", "(expr, x, domain)", "Solve, returning a set", "solveset(sin(x), x, Interval(0, 2pi))"),
        ("nsolve", "(expr, x, x0)", "Numerical root near x0", "nsolve(cos(x) - x, x, 1)"),
        ("linsolve", "([eqs], [vars])", "Solve a linear system", "linsolve([x + y - 3, x - y - 1], [x, y])"),
        ("dsolve", "(eq, f(x))", "Solve an ODE", "dsolve(Derivative(f(x), x) - f(x), f(x))"),
        ("Eq", "(lhs, rhs)", "An equation", "Eq(x^2, 4)"),
        ("roots", "(poly)", "Roots with multiplicities", "roots(x^3 - 3x + 2)"),
    ],
    "Calculus": [
        ("diff", "(expr, x, n=1)", "Derivative", "diff(sin(x) x^2, x)"),
        ("integrate", "(expr, x) or (expr, (x, a, b))", "Indefinite or definite integral", "integrate(x e^x, (x, 0, 1))"),
        ("limit", "(expr, x, a, dir='+-')", "Limit as x → a", "limit(sin(x)/x, x, 0)"),
        ("series", "(expr, x, a, n)", "Taylor series", "series(cos(x), x, 0, 6)"),
        ("summation", "(expr, (k, a, b))", "Sum", "summation(1/k^2, (k, 1, oo))"),
        ("product", "(expr, (k, a, b))", "Product", "product(k, (k, 1, 5))"),
        ("Derivative", "(expr, x)", "Unevaluated derivative (use .doit())", "Derivative(x^3, x)"),
        ("Integral", "(expr, x)", "Unevaluated integral (use .doit())", "Integral(1/x, (x, 1, e))"),
    ],
    "Linear algebra": [
        ("M[…]", "M[1, 2], M[[1, 2], [3, 4]]", "A matrix: one row, or a list of rows", "M[[1, 2], [3, 4]]"),
        ("V[…]", "V[1, 2, 3]", "A column vector", "V[1, 2, 3]"),
        ("det", "(A)", "Determinant", "det(M[[1, 2], [3, 4]])"),
        ("inv", "A.inv()", "Inverse (or A^-1)", "M[[1, 2], [3, 4]].inv()"),
        ("eigenvals", "A.eigenvals()", "Eigenvalues with multiplicities", "M[[2, 1], [1, 2]].eigenvals()"),
        ("eigenvects", "A.eigenvects()", "Eigenvectors", "M[[2, 1], [1, 2]].eigenvects()"),
        ("rref", "A.rref()", "Reduced row echelon form", "M[[1, 2, 3], [4, 5, 6]].rref()"),
        ("transpose", "A.T", "Transpose", "M[[1, 2], [3, 4]].T"),
        ("dot", "u.dot(v)", "Dot product", "V[1, 2, 3].dot(V[4, 5, 6])"),
        ("cross", "u.cross(v)", "Cross product", "V[1, 0, 0].cross(V[0, 1, 0])"),
        ("norm", "v.norm()", "Length of a vector", "V[3, 4].norm()"),
        ("rank", "A.rank()", "Rank", "M[[1, 2], [2, 4]].rank()"),
        ("nullspace", "A.nullspace()", "Basis of the null space", "M[[1, 2], [2, 4]].nullspace()"),
        ("Matrix", "(rows, cols, f)", "A matrix from a formula for each element", "Matrix(3, 3, lambda i, j: i + j)"),
        ("eye", "(n)", "Identity matrix", "eye(3)"),
        ("zeros", "(n, m)", "Zero matrix", "zeros(2, 3)"),
    ],
    "Numbers": [
        ("factorint", "(n)", "Prime factorization", "factorint(360)"),
        ("divisors", "(n)", "All divisors of n", "divisors(60)"),
        ("totient", "(n)", "Euler's totient φ(n)", "totient(12)"),
        ("prime", "(n)", "The n-th prime", "prime(100)"),
        ("nextprime", "(n)", "The first prime after n", "nextprime(1000)"),
        ("isprime", "(n)", "Primality test", "isprime(2^31 - 1)"),
        ("primerange", "(a, b)", "Primes in [a, b)", "list(primerange(1, 50))"),
        ("gcd", "(a, b)", "Greatest common divisor", "gcd(84, 36)"),
        ("lcm", "(a, b)", "Least common multiple", "lcm(4, 6)"),
        ("binomial", "(n, k)", "Binomial coefficient, nCk", "binomial(10, 3)"),
        ("ff", "(n, k)", "Falling factorial, nPk: ordered choices of k out of n", "ff(10, 3)"),
        ("factorial", "(n)", "n!", "factorial(10)"),
        ("Mod", "(a, n)", "a mod n", "Mod(17, 5)"),
        ("N", "(expr, digits)", "Numerical value to any precision", "N(pi, 50)"),
        ("Rational", "(p, q)", "Exact fraction", "Rational(1, 3)"),
        ("floor", "(x)", "Round down", "floor(7/2)"),
        ("ceiling", "(x)", "Round up", "ceiling(7/2)"),
        ("sign", "(x)", "Sign: -1, 0 or 1", "sign(-3)"),
    ],
    "Functions": [
        ("sqrt", "(x)", "Square root", "sqrt(8)"),
        ("root", "(x, n)", "n-th root", "root(27, 3)"),
        ("exp", "(x)", "Exponential", "exp(1)"),
        ("log", "(x, base=e)", "Logarithm (natural by default)", "log(8, 2)"),
        ("sin", "(x)", "Sine; also cos, tan, cot, sec, csc", "sin(pi/6)"),
        ("asin", "(x)", "Arcsine; also acos, atan, acot", "asin(1/2)"),
        ("atan2", "(y, x)", "Angle of the point (x, y)", "atan2(1, -1)"),
        ("°", "", "Degrees: 30° is 30·π/180 (also a palette button)", "sin(30°)"),
        ("deg", "(radians)", "Radians to degrees", "deg(pi/3)"),
        ("sinh", "(x)", "Hyperbolic sine; also cosh, tanh", "sinh(0)"),
        ("Abs", "(x)", "Absolute value (abs works too)", "Abs(-3)"),
        ("re", "(z)", "Real part", "re(3 + 4I)"),
        ("im", "(z)", "Imaginary part", "im(3 + 4I)"),
        ("arg", "(z)", "Argument (angle) of a complex number", "arg(1 + I)"),
        ("conjugate", "(z)", "Complex conjugate", "conjugate(3 + 4I)"),
        ("Piecewise", "((expr, cond), ...)", "Piecewise function", "Piecewise((x, x > 0), (-x, True))"),
    ],
    "Statistics": [
        ("mean", "(values)", "Arithmetic mean, exact", "mean([2, 4, 4, 5])"),
        ("median", "(values)", "Middle value", "median([3, 1, 4, 1, 5])"),
        ("variance", "(values)", "Sample variance (n - 1)", "variance([2, 4, 4, 5])"),
        ("stdev", "(values)", "Sample standard deviation (n - 1)", "stdev([2, 4, 4, 5])"),
        ("pvariance", "(values)", "Population variance (n)", "pvariance([2, 4, 4, 5])"),
        ("pstdev", "(values)", "Population standard deviation (n)", "pstdev([2, 4, 4, 5])"),
    ],
    "Plotting": [
        ("iplot", "(expr, (x, a, b))", "An interactive graph: drag to pan, pinch to zoom; or select it (↑) and ← → + − 0", "iplot(sin(x)/x, (x, -20, 20))"),
        ("plot", "(expr, (x, a, b))", "Plot a function of x; several: plot(f, g, (x, a, b))", "plot(sin(x), (x, -5, 5))"),
        ("plot_parametric", "((x(t), y(t)), (t, a, b))", "Plot a parametric curve", "plot_parametric((cos(t), sin(t)), (t, 0, 2pi))"),
        ("plot_implicit", "(Eq(lhs, rhs), (x, a, b), (y, c, d))", "Plot an implicit curve", "plot_implicit(Eq(x^2 + y^2, 4))"),
        ("plot3d", "(expr, (x, a, b), (y, c, d))", "Plot a surface z = f(x, y)", "plot3d(x y, (x, -2, 2), (y, -2, 2))"),
    ],
    "Constants": [
        ("pi", "", "π", "pi"),
        ("E", "", "Euler's number (also exp(1))", "E"),
        ("I", "", "Imaginary unit", "I^2"),
        ("oo", "", "Infinity", "oo"),
    ],
}


def _entry(name, signature, summary, example, category):
    if name.startswith((":", "$")) or " " in name:
        insert = example
    elif "." in signature.split("(")[0]:
        # methods: M.inv() -> ".inv()", M.T -> ".T"
        method = signature.split(".", 1)[1]
        insert = "." + (method.split("(")[0] + "(" if "(" in method else method)
    elif signature.startswith("("):
        insert = f"{name}("
    else:
        insert = name
    return {
        "name": name,
        "signature": signature,
        "summary": summary,
        "example": example,
        "category": category,
        "source": "sympy",
        "doc": "",
        "insert": insert,
    }


def catalog_entries():
    return [
        _entry(name, sig, summary, example, category)
        for category, items in SYMPY.items()
        for name, sig, summary, example in items
    ]
