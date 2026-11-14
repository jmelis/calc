"""
Descriptive statistics for the calculator, exact like the rest of sympy:
mean([1, 2, 3, 4]) is 5/2, not 2.5.

Each takes a list (or tuple, set, Matrix) or the values as arguments:
mean([1, 2, 3]) == mean(1, 2, 3). variance/stdev are the sample versions
(divide by n - 1), pvariance/pstdev the population ones (divide by n).
"""
from sympy import Add, sqrt, sympify
from sympy.matrices import MatrixBase


def _values(args, at_least=1):
    if len(args) == 1 and isinstance(args[0], (list, tuple, set, frozenset, MatrixBase)):
        args = list(args[0])
    values = [sympify(v) for v in args]
    if len(values) < at_least:
        raise ValueError(f"needs at least {at_least} value{'s' if at_least > 1 else ''}")
    return values


def mean(*xs):
    """Arithmetic mean: mean([1, 2, 3, 4]) -> 5/2"""
    values = _values(xs)
    return Add(*values) / len(values)


def median(*xs):
    """Middle value (mean of the two middle ones for an even count): median([3, 1, 4, 1]) -> 2"""
    values = sorted(_values(xs))
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def _sum_of_squares(values):
    m = mean(values)
    return Add(*[(v - m) ** 2 for v in values])


def variance(*xs):
    """Sample variance (divides by n - 1): variance([1, 2, 3, 4]) -> 5/3"""
    values = _values(xs, at_least=2)
    return _sum_of_squares(values) / (len(values) - 1)


def stdev(*xs):
    """Sample standard deviation: stdev([1, 2, 3, 4]) -> sqrt(15)/3"""
    return sqrt(variance(*xs))


def pvariance(*xs):
    """Population variance (divides by n): pvariance([1, 2, 3, 4]) -> 5/4"""
    values = _values(xs)
    return _sum_of_squares(values) / len(values)


def pstdev(*xs):
    """Population standard deviation: pstdev([1, 2, 3, 4]) -> sqrt(5)/2"""
    return sqrt(pvariance(*xs))


FUNCTIONS = {f.__name__: f for f in (mean, median, variance, stdev, pvariance, pstdev)}
