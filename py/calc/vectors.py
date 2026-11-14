"""
Lists that do vector and matrix math, for the calculator's [ ] brackets.

A list typed in the calculator is still a list (indexing, len, sum, comprehensions,
solve([...], [...]) all see one), but arithmetic and matrix methods treat it as a
matrix: a flat list is a column vector, a list of equal-length lists is a matrix.

    2[1, 2, 3]              [2, 4, 6]
    [1, 2] + [3, 4]         [4, 6]
    [[1, 2], [3, 4]]^-1     the inverse
    M [1, 1]                matrix times vector
    det(M), M.T, v.dot(w)   matrix functions and methods

What arithmetic returns is a SymPy matrix; the session shows (and keeps) one-column
results as flat lists again, so vectors stay vectors.
"""
from sympy import ImmutableMatrix, Matrix
from sympy.core.basic import Basic
from sympy.matrices import MatrixBase, ShapeError


def _numeric(value):
    """Whether a (possibly nested) list holds only things a matrix can: numbers and expressions."""
    if isinstance(value, (list, MatrixBase)):
        return all(_numeric(v) for v in value)
    return isinstance(value, (int, float, complex, Basic)) and not isinstance(value, bool)


class Vector(list):
    """A list; see the module docstring. Lists of other things (strings) stay plain lists."""

    _op_priority = 20  # SymPy's operators (Matrix + Vector) defer to ours, above Matrix's 10.01

    def _matrix(self):
        return Matrix(_plain(self))

    def _sympy_(self):
        # what SymPy's functions see (diff, simplify, det): a matrix
        if not _numeric(self):
            raise TypeError("only lists of numbers and expressions work as vectors")
        return ImmutableMatrix(_plain(self))

    def __getattr__(self, name):
        # matrix methods and properties: v.dot(w), M.inv(), M.T; not _private or __dunder__
        # names, which Python and SymPy probe for (pickle, _repr_latex_)
        if name.startswith("_") or not _numeric(self):
            raise AttributeError(name)
        attr = getattr(self._matrix(), name)
        if not callable(attr):
            return attr

        def method(*args, **kwargs):  # v.cross(w): some methods insist on a Matrix argument
            return attr(*(Matrix(_plain(a)) if isinstance(a, Vector) and _numeric(a) else a for a in args), **kwargs)

        return method

    def __getitem__(self, key):
        if isinstance(key, tuple) and _numeric(self):
            return self._matrix()[key]  # M[0, 1], M[:, 0]
        return super().__getitem__(key)

    def __setitem__(self, key, value):
        if not isinstance(key, tuple):
            return super().__setitem__(key, value)  # v[0] = 9, M[1] = [7, 8]
        if len(key) != 2 or any(isinstance(k, slice) for k in key):
            raise TypeError("set one element, M[i, j] = …, or a row, M[i] = […]")
        row = super().__getitem__(key[0])
        if not isinstance(row, list):
            raise TypeError("M[i, j] = … needs a matrix (a list of rows)")
        row[key[1]] = value

    def _math(self, other, op, plain=None):
        if not _numeric(self) or not _numeric(other):
            if plain is None:
                return NotImplemented
            return plain(other)  # lists of strings: Python's list behaviour
        a = self._matrix()
        b = Matrix(_plain(other)) if isinstance(other, list) else other
        if op is _mul and _flat(self) and isinstance(b, MatrixBase) and b.cols > 1:
            return Vector(a.T * b)  # a vector before a matrix is a row: [1, 1] M
        try:
            return op(a, b)
        except ShapeError:
            if op in (_mul, _rmul) and isinstance(other, list) and _flat(self) and _flat(other):
                raise TypeError("* doesn't multiply two vectors: use v.dot(w) or v.cross(w)") from None
            raise

    def __add__(self, other):
        return self._math(other, lambda a, b: a + b, super().__add__)

    def __radd__(self, other):
        return self._math(other, lambda a, b: b + a)

    def __sub__(self, other):
        return self._math(other, lambda a, b: a - b)

    def __rsub__(self, other):
        return self._math(other, lambda a, b: b - a)

    def __mul__(self, other):
        return self._math(other, _mul, super().__mul__)

    def __rmul__(self, other):
        return self._math(other, _rmul, super().__rmul__)

    def __matmul__(self, other):
        return self._math(other, _mul)

    def __rmatmul__(self, other):
        return self._math(other, _rmul)

    def __truediv__(self, other):
        return self._math(other, lambda a, b: a / b)

    def __pow__(self, other):
        return self._math(other, lambda a, b: a**b)

    def __neg__(self):
        return -self._matrix()

    def __pos__(self):
        return self._matrix()


def _mul(a, b):
    return a * b


def _rmul(a, b):
    return b * a


def _plain(value):
    """Plain lists for Matrix(), which would otherwise probe a Vector's attributes (shape),
    which __getattr__ answers by building a Matrix."""
    return [_plain(v) for v in value] if isinstance(value, list) else value


def is_matrix(value):
    """A list of equal-length rows of numbers and expressions: shown as a matrix."""
    return (
        isinstance(value, list)
        and len(value) > 0
        and all(isinstance(row, list) and len(row) == len(value[0]) > 0 and _flat(row) for row in value)
        and _numeric(value)
    )


def _flat(value):
    return not any(isinstance(v, list) for v in value)


def vector(value):
    """A list (and the lists in it) as Vectors; anything else unchanged."""
    if isinstance(value, list):
        return Vector(vector(v) for v in value)
    return value


def as_vector(value):
    """How results are kept: one-column matrices as flat Vectors, lists as Vectors, also
    inside lists and tuples (eigenvects, nullspace)."""
    if isinstance(value, MatrixBase) and value.cols == 1 and value.rows > 0:
        return Vector(value)
    if isinstance(value, list):
        return Vector(as_vector(v) for v in value)
    if type(value) is tuple:
        return tuple(as_vector(v) for v in value)
    return value
