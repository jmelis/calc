"""
Live preview: typeset the input as typed, without evaluating anything.

The calculator transformations (2x, ^, sin x, 5!, ...) are applied to get Python
source, which is then walked as an AST and rendered to LaTeX. Nothing is executed,
so the preview is safe to run on every keystroke and shows
exactly what was typed (integrate(...) renders as an integral, not its result).
"""
import ast

from sympy import Symbol, latex
from sympy.printing.latex import greek_letters_set

from .matrices import MatrixMaker
from .parser import _GLOBALS, DEG_NAME, REFS_NAME, _callable, classify, to_python

PREC_ADD, PREC_MUL, PREC_NEG, PREC_POW, PREC_ATOM = 1, 2, 3, 4, 5

CONSTANTS = {"pi": r"\pi", "E": "e", "I": "i", "oo": r"\infty", "zoo": r"\tilde{\infty}", "nan": r"\text{NaN}"}
KATEX_FUNCS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "sinh", "cosh", "tanh", "coth",
    "arcsin", "arccos", "arctan", "exp", "log", "ln", "max", "min", "det", "gcd", "deg",
}
NAMED_FUNCS = {"asin": r"\arcsin", "acos": r"\arccos", "atan": r"\arctan", "gamma": r"\Gamma"}
COMPARE = {ast.Eq: "=", ast.NotEq: r"\ne", ast.Lt: "<", ast.LtE: r"\le", ast.Gt: ">", ast.GtE: r"\ge"}


def _paren(s):
    return rf"\left({s}\right)"


def _symbol(name):
    if name in CONSTANTS:
        return CONSTANTS[name]
    if len(name) > 1 and name.lower() not in greek_letters_set and "_" not in name:
        return rf"\mathrm{{{name}}}"
    return latex(Symbol(name))


class _Renderer:
    def __init__(self, makers=None):
        self.makers = makers or {}  # name -> MatrixMaker, for M[1, 2] and V[1, 2]

    def render(self, node):
        """Return (latex, precedence)."""
        method = getattr(self, f"_{type(node).__name__}", None)
        if method is None:
            raise ValueError(f"no preview for {type(node).__name__}")
        return method(node)

    def tex(self, node, min_prec=0):
        s, prec = self.render(node)
        return _paren(s) if prec < min_prec else s

    def right(self, node, min_prec):
        """Right operand of a binary operator: also parenthesize negatives (x - (-3))."""
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return _paren(self.tex(node))
        return self.tex(node, min_prec)

    # --- atoms ---

    def _Expression(self, node):
        return self.render(node.body)

    def _Name(self, node):
        if node.id == "ans":
            return r"\mathrm{ans}", PREC_ATOM
        return _symbol(node.id), PREC_ATOM

    def _Constant(self, node):
        v = node.value
        if isinstance(v, str):
            return rf"\text{{{v}}}", PREC_ATOM
        if isinstance(v, bool) or v is None:
            return rf"\text{{{v}}}", PREC_ATOM
        return str(v), PREC_ATOM

    def _List(self, node):
        return rf"\left[{self._items(node.elts)}\right]", PREC_ATOM

    def _Tuple(self, node):
        return _paren(self._items(node.elts)), PREC_ATOM

    def _Set(self, node):
        return rf"\left\{{{self._items(node.elts)}\right\}}", PREC_ATOM

    def _Dict(self, node):
        pairs = [f"{self.tex(k)}: {self.tex(v)}" for k, v in zip(node.keys, node.values)]
        return rf"\left\{{{', '.join(pairs)}\right\}}", PREC_ATOM

    def _Subscript(self, node):
        if isinstance(node.value, ast.Name) and node.value.id in self.makers:
            return self._matrix_maker(self.makers[node.value.id], node.slice)
        if isinstance(node.value, ast.Name) and node.value.id == REFS_NAME:
            return rf"\boxed{{{self.tex(node.slice)}}}", PREC_ATOM
        return f"{self.tex(node.value, PREC_ATOM)}_{{{self.tex(node.slice)}}}", PREC_ATOM

    def _Attribute(self, node):
        if node.attr == "T":
            return f"{self.tex(node.value, PREC_ATOM)}^{{T}}", PREC_POW
        return rf"{self.tex(node.value, PREC_ATOM)}.\mathrm{{{node.attr}}}", PREC_ATOM

    def _matrix_maker(self, maker, key):
        """M[1, 2] (a row), M[[1, 2], [3, 4]] (rows), V[1, 2] (a column), as matrices.py reads them."""
        items = key.elts if isinstance(key, ast.Tuple) else [key]
        if all(isinstance(item, ast.List) for item in items):
            rows = [item.elts for item in items]
        elif not any(isinstance(item, ast.List) for item in items):
            rows = [items]
        else:
            raise ValueError("matrix")
        if maker.column:
            rows = [list(column) for column in zip(*rows)]
        body = r" \\ ".join(" & ".join(self.tex(e) for e in row) for row in rows)
        return rf"\begin{{bmatrix}}{body}\end{{bmatrix}}", PREC_ATOM

    def _items(self, nodes):
        return ", ".join(self.tex(n) for n in nodes)

    # --- operators ---

    def _BinOp(self, node):
        op = type(node.op)
        if op is ast.Add:
            return f"{self.tex(node.left, PREC_ADD)} + {self.right(node.right, PREC_ADD)}", PREC_ADD
        if op is ast.Sub:
            return f"{self.tex(node.left, PREC_ADD)} - {self.right(node.right, PREC_MUL)}", PREC_ADD
        if op is ast.Mult and isinstance(node.right, ast.Name) and node.right.id == DEG_NAME:
            return f"{self.tex(node.left, PREC_ATOM)}^{{\\circ}}", PREC_POW
        if op is ast.Mult:
            left, right = self.tex(node.left, PREC_MUL), self.right(node.right, PREC_MUL)
            # juxtapose like sympy (2x, x y), but keep the dot before a number: 2 \cdot 3
            explicit = right[0].isdigit() or self._is_number(node.right)
            return rf"{left} \cdot {right}" if explicit else f"{left} {right}", PREC_MUL
        if op is ast.Div:
            return rf"\frac{{{self.tex(node.left)}}}{{{self.tex(node.right)}}}", PREC_ATOM
        if op is ast.Pow:
            return f"{{{self.tex(node.left, PREC_ATOM)}}}^{{{self.tex(node.right)}}}", PREC_POW
        if op is ast.Mod:
            return rf"{self.tex(node.left, PREC_MUL)} \bmod {self.tex(node.right, PREC_MUL)}", PREC_MUL
        if op is ast.MatMult:
            return rf"{self.tex(node.left, PREC_MUL)} {self.tex(node.right, PREC_MUL)}", PREC_MUL
        raise ValueError("operator")

    def _UnaryOp(self, node):
        if isinstance(node.op, ast.USub):
            return f"-{self.tex(node.operand, PREC_NEG)}", PREC_NEG
        if isinstance(node.op, ast.UAdd):
            return self.render(node.operand)
        raise ValueError("operator")

    def _Compare(self, node):
        parts = [self.tex(node.left)]
        for op, right in zip(node.ops, node.comparators):
            parts += [COMPARE[type(op)], self.tex(right)]
        return " ".join(parts), 0

    def _Lambda(self, node):
        args = ", ".join(_symbol(a.arg) for a in node.args.args)
        return rf"\left({args} \mapsto {self.tex(node.body)}\right)", PREC_ATOM

    @staticmethod
    def _is_number(node):
        return isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) or (
            isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
            and node.func.id in ("Integer", "Float", "Number") and node.args
        )

    # --- calls ---

    def _Call(self, node):
        func, args = node.func, node.args
        if isinstance(func, ast.Name) and func.id in ("Integer", "Float", "Number", "Symbol") and args:
            value = args[0].value if isinstance(args[0], ast.Constant) else None
            if func.id == "Symbol":
                return _symbol(str(value)), PREC_ATOM
            return str(value), PREC_ATOM
        if isinstance(func, ast.Call) and isinstance(func.func, ast.Name) and func.func.id == "Function":
            name = func.args[0].value
        elif isinstance(func, ast.Name):
            name = func.id
        elif isinstance(func, ast.Attribute):
            # M.det() -> det(M), M.subs(x, 2) -> subs(M, x, 2)
            return self._function(func.attr, [func.value, *args])
        else:
            raise ValueError("call")
        special = getattr(self, f"_call_{name.lower()}", None)
        if special is not None:
            try:
                return special(args)
            except (IndexError, ValueError):
                pass
        return self._function(name, args)

    def _function(self, name, args):
        if name in NAMED_FUNCS:
            head = NAMED_FUNCS[name]
        elif name in KATEX_FUNCS:
            head = "\\" + name
        elif len(name) == 1 or name.lower() in greek_letters_set:
            head = _symbol(name)
        else:
            head = rf"\operatorname{{{name}}}"
        return f"{head}{_paren(self._items(args))}", PREC_ATOM

    def _call_sqrt(self, args):
        return rf"\sqrt{{{self.tex(args[0])}}}", PREC_ATOM

    def _call_root(self, args):
        return rf"\sqrt[{self.tex(args[1])}]{{{self.tex(args[0])}}}", PREC_ATOM

    def _call_cbrt(self, args):
        return rf"\sqrt[3]{{{self.tex(args[0])}}}", PREC_ATOM

    def _call_exp(self, args):
        return f"e^{{{self.tex(args[0])}}}", PREC_POW

    def _call_abs(self, args):
        return rf"\left|{self.tex(args[0])}\right|", PREC_ATOM

    def _call_log(self, args):
        if len(args) == 2:
            return rf"\log_{{{self.tex(args[1], PREC_ATOM)}}}{_paren(self.tex(args[0]))}", PREC_ATOM
        return rf"\log{_paren(self.tex(args[0]))}", PREC_ATOM

    def _call_factorial(self, args):
        return f"{self.tex(args[0], PREC_ATOM)}!", PREC_ATOM

    def _call_binomial(self, args):
        return rf"\binom{{{self.tex(args[0])}}}{{{self.tex(args[1])}}}", PREC_ATOM

    def _call_rational(self, args):
        return rf"\frac{{{self.tex(args[0])}}}{{{self.tex(args[1])}}}", PREC_ATOM

    def _call_eq(self, args):
        return f"{self.tex(args[0])} = {self.tex(args[1])}", 0

    def _call_matrix(self, args):
        (arg,) = args
        if not isinstance(arg, ast.List):
            raise ValueError("matrix")
        rows = arg.elts if all(isinstance(r, ast.List) for r in arg.elts) else [ast.List([e]) for e in arg.elts]
        body = r" \\ ".join(" & ".join(self.tex(e) for e in r.elts) for r in rows)
        return rf"\begin{{bmatrix}}{body}\end{{bmatrix}}", PREC_ATOM

    _call_m = _call_matrix

    def _limits(self, node):
        """(x, a, b) -> (x, a, b) rendered; bare x -> (x, None, None)."""
        if isinstance(node, ast.Tuple) and len(node.elts) == 3:
            return tuple(self.tex(e) for e in node.elts)
        return self.tex(node), None, None

    def _call_integrate(self, args):
        f, *specs = args
        if not specs:
            raise ValueError("integral without variable")
        out = self.tex(f, PREC_MUL)
        for spec in reversed(specs):
            var, a, b = self._limits(spec)
            bounds = f"_{{{a}}}^{{{b}}}" if a is not None else ""
            out = rf"\int{bounds} {out}\, d{var}"
        return out, PREC_MUL

    _call_integral = _call_integrate

    def _call_diff(self, args):
        f, *rest = args
        if not rest:
            raise ValueError("diff without variable")
        # diff(f, x, 2) or diff(f, x, y)
        if len(rest) == 2 and self._is_number(rest[1]):
            var, n = self.tex(rest[0]), self.tex(rest[1])
            return rf"\frac{{d^{{{n}}}}}{{d{var}^{{{n}}}}} {self.tex(f, PREC_MUL)}", PREC_MUL
        if len(rest) == 1:
            return rf"\frac{{d}}{{d{self.tex(rest[0])}}} {self.tex(f, PREC_MUL)}", PREC_MUL
        denom = " ".join(rf"\partial {self.tex(v)}" for v in rest)
        return rf"\frac{{\partial^{{{len(rest)}}}}}{{{denom}}} {self.tex(f, PREC_MUL)}", PREC_MUL

    _call_derivative = _call_diff

    def _call_limit(self, args):
        f, var, point, *rest = args
        direction = ""
        if rest and isinstance(rest[0], ast.Constant) and rest[0].value in ("+", "-"):
            direction = f"^{rest[0].value}"
        return rf"\lim_{{{self.tex(var)} \to {self.tex(point)}{direction}}} {self.tex(f, PREC_MUL)}", PREC_MUL

    def _big_operator(self, symbol, args):
        f, spec = args
        var, a, b = self._limits(spec)
        if a is None:
            raise ValueError("sum without bounds")
        return rf"{symbol}_{{{var}={a}}}^{{{b}}} {self.tex(f, PREC_MUL)}", PREC_MUL

    def _call_summation(self, args):
        return self._big_operator(r"\sum", args)

    _call_sum = _call_summation

    def _call_product(self, args):
        return self._big_operator(r"\prod", args)


def _render(src, ns):
    tree = ast.parse(to_python(src, ns), mode="eval")
    makers = {name: value for name, value in ns.items() if isinstance(value, MatrixMaker)}
    return _Renderer(makers).tex(tree)


def preview(src, variables=(), functions=()):
    """
    LaTeX for the input as typed. Raises on syntax errors.

    `variables` / `functions` are names defined in the session, so they are kept
    whole instead of being split into products of letters (ab -> a*b).
    """
    ns = dict(_GLOBALS)
    ns.update({name: _callable for name in functions})
    ns.update({name: Symbol(name) for name in variables})
    ns["ans"] = Symbol("ans")
    ns[REFS_NAME] = {}

    kind, data = classify(src)
    if kind == "expr":
        return _render(data, ns)
    if kind == "equation":
        lhs, rhs = data
        return f"{_render(lhs, ns)} = {_render(rhs, ns)}"
    if kind == "assign":
        names, rhs = data
        return rf"{', '.join(_symbol(n) for n in names)} = {_render(rhs, ns)}"
    if kind == "setitem":
        _, target, rhs = data
        return f"{_render(target, ns)} = {_render(rhs, ns)}"
    name, args, body = data
    ns.update({a: Symbol(a) for a in args})
    head = _Renderer()._function(name, [ast.Name(a) for a in args])[0]
    return rf"{head} = {_render(body, ns)}"

