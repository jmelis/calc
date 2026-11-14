"""
Calculator syntax on top of SymPy's parse_expr.

Used for both the live preview (see preview.py) and evaluation (see session.py).

Rules:
    2x, sin x, x^2, 5!      implicit multiplication/application, ^ is power, factorial
    xy, x2, velocity        names are whole words; x y or x*y multiplies
    a = expr                assign a variable (a := expr works too)
    a, b = expr             assign several (expr must be iterable)
    f(x, y) = expr          define a function (a Lambda)
    lhs = rhs               anything else with a top-level '=' is an equation (Eq)
    solve(x^2 = 2, x)       so is '=' inside brackets, unless it's a keyword argument
    $4                      the result of tape entry 4
    30°                     degrees: sin(30°) is 1/2 (º, the look-alike on Option+0, works too)
    [1, 2], [[1, 2], [3, 4]] lists that are also vectors and matrices (see vectors.py)
"""
import ast
import builtins
import difflib
import keyword
import re

from sympy import Max, Min, Symbol
from sympy.utilities.iterables import iterable
from sympy.parsing.sympy_parser import (
    ENDMARKER,
    NAME,
    NEWLINE,
    NUMBER,
    OP,
    AppliedFunction,
    _apply_functions,
    _flatten,
    _group_parentheses,
    _token_callable,
    convert_xor,
    eval_expr,
    function_exponentiation,
    implicit_multiplication,
    standard_transformations,
    stringify_expr,
)

from .vectors import vector


class UnknownFunctionError(NameError):
    pass


def reject_unknown_calls(tokens, local_dict, global_dict):
    """
    A multi-letter name nobody defined, called like a function, is an error rather than
    an undefined symbolic function: slove(x) is almost certainly a typo for solve.
    auto_symbol has already turned such a call into Function('slove')(...). A single
    letter, p(x), stays a product p*x, as on a calculator.
    """
    for i, tok in enumerate(tokens):
        if tok == (NAME, "Function") and i + 2 < len(tokens) and tokens[i + 1] == (OP, "("):
            name = tokens[i + 2][1].strip("'\"")
            if len(name) > 1:
                known = [n for n, v in {**global_dict, **local_dict}.items() if callable(v) and not n.startswith("_")]
                close = difflib.get_close_matches(name, known, n=1, cutoff=0.75)
                hint = f" (did you mean {close[0]}?)" if close else ""
                raise UnknownFunctionError(f"unknown function '{name}'{hint}")
    return tokens


def _implicit_application(tokens, local_dict, global_dict):
    """
    sympy's _implicit_application, fixed: there, a non-callable name followed by **
    is caught by the function-exponentiation branch and never gets its closing
    paren, so `sin x^2` is a SyntaxError as soon as x is a defined name.
    """
    result = []
    appendParen = 0
    skip = 0
    exponentSkip = False
    for tok, nextTok in zip(tokens, tokens[1:]):
        result.append(tok)
        if tok[0] == NAME and nextTok[0] not in [OP, ENDMARKER, NEWLINE]:
            if _token_callable(tok, local_dict, global_dict, nextTok):
                result.append((OP, "("))
                appendParen += 1
        elif (tok[0] == NAME and nextTok[0] == OP and nextTok[1] == "**"
              and _token_callable(tok, local_dict, global_dict)):
            exponentSkip = True
        elif exponentSkip:
            if isinstance(tok, AppliedFunction) or (tok[0] == OP and tok[1] == "*"):
                if not (nextTok[0] == OP and nextTok[1] == "*"):
                    if not (nextTok[0] == OP and nextTok[1] == "("):
                        result.append((OP, "("))
                        appendParen += 1
                    exponentSkip = False
        elif appendParen:
            if nextTok[0] == OP and nextTok[1] in ("^", "**", "*"):
                skip = 1
                continue
            if skip:
                skip -= 1
                continue
            result.append((OP, ")"))
            appendParen -= 1

    if tokens:
        result.append(tokens[-1])
    if appendParen:
        result.extend([(OP, ")")] * appendParen)
    return result


def number_times_bracket(tokens, local_dict, global_dict):
    """2[1, 2] multiplies (a number can't be indexed); before auto_number makes the 2 a
    call, whose ) before [ must stay indexing, as in solve(...)[0]."""
    result = []
    for tok, next_tok in zip(tokens, tokens[1:] + [(ENDMARKER, "")]):
        result.append(tok)
        if tok[0] == NUMBER and next_tok == (OP, "["):
            result.append((OP, "*"))
    return result


# Python keywords (for, in, if, not, …) are hidden from implicit multiplication and
# application as operators, so [k^2 for k in range(5)] isn't k^2*for*k*in*range(5)
def hide_keywords(tokens, local_dict, global_dict):
    return [(OP, tok[1]) if tok[0] == NAME and keyword.iskeyword(tok[1]) else tok for tok in tokens]


def restore_keywords(tokens, local_dict, global_dict):
    return [(NAME, tok[1]) if tok[0] == OP and keyword.iskeyword(tok[1]) else tok for tok in tokens]


def implicit_application(tokens, local_dict, global_dict):
    """sympy's implicit_application, using the fixed _implicit_application above."""
    res1 = _group_parentheses(implicit_application)(tokens, local_dict, global_dict)
    res2 = _apply_functions(res1, local_dict, global_dict)
    res3 = _implicit_application(res2, local_dict, global_dict)
    return _flatten(res3)


# Names are whole words, defined or not: xy is the name xy, never x*y (write x y or
# x*y), so a name's meaning doesn't change when something gets defined. sympy's
# split_symbols is deliberately left out.
TRANSFORMATIONS = (number_times_bracket,) + standard_transformations + (
    convert_xor,
    reject_unknown_calls,
    hide_keywords,
    implicit_multiplication,
    implicit_application,
    function_exponentiation,
    restore_keywords,
)

IDENT = r"[A-Za-z_]\w*"
IDENTS = rf"{IDENT}(?:\s*,\s*{IDENT})*"
ASSIGN_RE = re.compile(rf"^\s*({IDENTS})\s*$")
DEFINE_RE = re.compile(rf"^\s*({IDENT})\s*\(\s*({IDENTS})\s*\)\s*$")
SETITEM_RE = re.compile(rf"^\s*({IDENT})\s*(?:\[[^\[\]]+\]\s*)+$")  # M[0, 1], v[0], M[0][1]
REF_RE = re.compile(r"\$(\d+)")
# Comprehension variables: for i in, for i, j in
FOR_RE = re.compile(rf"\bfor\s+\(?\s*({IDENTS})\s*\)?\s+in\b")
# Lines that start with one of these are Python statements, run as Python
STATEMENT_RE = re.compile(
    r"^\s*(def|class|for|while|if|with|try|import|from|del|global|nonlocal|assert|raise|pass|async)\b"
)
REFS_NAME = "_calc_out"

# What parse_expr uses by default: sympy plus builtin functions, so abs(x) isn't split into a*b*s
_GLOBALS = {}
exec("from sympy import *", _GLOBALS)
# Python's builtins too (type, len, sorted, …), without overriding sympy's names and
# without the ones that make no sense in a calculator
NOT_BUILTINS = {"exit", "quit", "copyright", "credits", "license", "input", "breakpoint"}
for _name, _value in vars(builtins).items():
    if not _name.startswith("_") and callable(_value) and _name not in NOT_BUILTINS:
        _GLOBALS.setdefault(_name, _value)


def _of_list(fn):
    """max and min as on a calculator, Max and Min, also of a list: max([1, 5, 3])"""
    def wrapper(*args, **kwargs):
        return fn(*args[0], **kwargs) if len(args) == 1 and iterable(args[0]) else fn(*args, **kwargs)

    wrapper.__name__ = wrapper.__qualname__ = fn.__name__.lower()
    return wrapper


_GLOBALS.update(max=_of_list(Max), min=_of_list(Min))
# 30° becomes 30*_deg; a name of its own so the preview can show it as a degree sign
DEG_NAME = "_deg"
_GLOBALS[DEG_NAME] = _GLOBALS["pi"] / 180
# [ ] and list comprehensions become vector(...): lists that also do vector math
VECTOR_NAME = "_vector"
_GLOBALS[VECTOR_NAME] = vector


def split_names(s):
    return [n.strip() for n in s.split(",")]


def split_top_level_equals(src):
    """Split on the first '=' outside brackets/strings that isn't part of ==, <=, >=, !=; a := b splits like a = b."""
    depth = 0
    quote = None
    for i, ch in enumerate(src):
        if quote:
            if ch == quote and src[i - 1] != "\\":
                quote = None
        elif ch in "'\"":
            quote = ch
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "=" and depth == 0:
            prev = src[i - 1] if i else ""
            nxt = src[i + 1] if i + 1 < len(src) else ""
            if prev not in "=<>!" and nxt != "=":
                return src[:i].removesuffix(":"), src[i + 1:]
    return None


CLOSERS = {"(": ")", "[": "]", "{": "}"}


def rewrite_inner_equations(src):
    """solve(x^2 = 2, x) -> solve(Eq(x^2 , 2), x); keyword arguments (dict=True) are left alone."""

    def group(i, closer):
        """Rewrite from src[i] up to `closer`; return (text, index after closer)."""
        args, current = [], []
        while i < len(src):
            ch = src[i]
            if ch in "'\"":
                end = src.find(ch, i + 1)
                end = len(src) - 1 if end == -1 else end
                current.append(src[i:end + 1])
                i = end + 1
            elif ch in CLOSERS:
                inner, i = group(i + 1, CLOSERS[ch])
                current.append(ch + inner + CLOSERS[ch])
            elif ch == closer:
                args.append("".join(current))
                return ",".join(as_equation(a) for a in args), i + 1
            elif ch == "," and closer:
                args.append("".join(current))
                current = []
                i += 1
            else:
                current.append(ch)
                i += 1
        if closer:
            raise ValueError("unbalanced brackets")
        args.append("".join(current))
        return ",".join(args), i

    def as_equation(arg):
        parts = split_top_level_equals(arg)
        if parts is None or ASSIGN_RE.match(parts[0]):
            return arg
        return f"Eq({parts[0]}, {parts[1]})"

    try:
        return group(0, None)[0]
    except ValueError:
        return src  # leave it to the parser to report


def is_statement(src):
    """def f(x): …, for …, import …: Python statements rather than calculator syntax."""
    return bool(STATEMENT_RE.match(src))


def classify(src):
    """
    Return (kind, data):
        ("expr", src)
        ("assign", (names, rhs))
        ("define", (name, args, body))
        ("setitem", (name, target, rhs))    M[0, 1] = 5: change part of a value
        ("equation", (lhs, rhs))
    """
    parts = split_top_level_equals(src)
    if parts is None:
        return "expr", src
    lhs, rhs = parts
    if m := DEFINE_RE.match(lhs):
        return "define", (m[1], split_names(m[2]), rhs)
    if m := ASSIGN_RE.match(lhs):
        return "assign", (split_names(m[1]), rhs)
    if m := SETITEM_RE.match(lhs):
        return "setitem", (m[1], lhs, rhs)
    return "equation", (lhs, rhs)


def _callable(*args, **kwargs):
    pass


_VALUE = Symbol("_")


def _shadow(value):
    """
    What the tokenizer sees for a defined name. It only needs to know whether the
    name is callable (so `f x` means f(x)), and it calls bool() on the value, which
    raises for things like Eq; so give it a harmless stand-in.
    """
    if isinstance(value, Symbol):
        return value
    return _callable if callable(value) else _VALUE


def rewrite_degrees(src):
    """
    30° -> (30*_deg). ° binds to the value right before it (a number, a name, or a
    bracketed group with the call it belongs to), so atan(1)/1° divides by 1°.
    """
    # º (U+00BA, Option+0 on a Mac) is easy to type by mistake for ° (U+00B0)
    src = src.replace("º", "°")
    while "°" in src:
        end = src.index("°")
        start = end
        while start > 0 and src[start - 1] == " ":
            start -= 1
        if start and src[start - 1] in ")]":
            depth = 0
            for start in range(start - 1, -1, -1):
                depth += {")": 1, "]": 1, "(": -1, "[": -1}.get(src[start], 0)
                if depth == 0:
                    break
        while start > 0 and (src[start - 1].isalnum() or src[start - 1] in "._$"):
            start -= 1
        if start == end:
            raise SyntaxError("° needs a value before it, as in 30°")
        src = f"{src[:start]}({src[start:end]}*{DEG_NAME}){src[end + 1:]}"
    return src


def to_python(src, namespace):
    """The Python code calculator syntax turns into, without evaluating it."""
    src = rewrite_degrees(src)
    src = rewrite_inner_equations(REF_RE.sub(rf" {REFS_NAME}[\1] ", src))
    shadow = {name: _shadow(value) for name, value in namespace.items()}
    # loop variables stay plain names (auto_symbol would make `for i` `for Symbol('i')`)
    shadow.update((name, Symbol(name)) for names in FOR_RE.findall(src) for name in split_names(names))
    return stringify_expr(src, shadow, _GLOBALS, TRANSFORMATIONS)


class _Vectors(ast.NodeTransformer):
    def visit_List(self, node):
        return self._wrap(node)

    def visit_ListComp(self, node):
        return self._wrap(node)

    def _wrap(self, node):
        self.generic_visit(node)
        return ast.Call(ast.Name(VECTOR_NAME, ast.Load()), [node], [])


def parse(src, namespace):
    """Parse and evaluate calculator syntax, resolving names from `namespace`."""
    tree = ast.fix_missing_locations(_Vectors().visit(ast.parse(to_python(src, namespace), mode="eval")))
    return eval_expr(compile(tree, "<calc>", "eval"), namespace, _GLOBALS)
