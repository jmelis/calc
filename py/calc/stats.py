"""
Statistics for the calculator, exact like the rest of sympy:
mean([1, 2, 3, 4]) is 5/2, not 2.5.

Each takes a list (or tuple, set, Matrix) or the values as arguments:
mean([1, 2, 3]) == mean(1, 2, 3). variance/stdev are the sample versions
(divide by n - 1), pvariance/pstdev the population ones (divide by n).

They also take a random variable (sympy.stats), X = Poisson("X", 4): mean(X) is its
expectation (sympy.stats' E, which here is Euler's number), variance(X) its variance.
P(X <= 2) is a probability, and pdf(X, 1), cdf(X, 2) the p.m.f. (or p.d.f.) and c.d.f.
at a point: sympy.stats' density(X)(1) and cdf(X)(2) would read as products here, as
(a)(b) does.
"""
import functools

from sympy import Add, Basic, S, sqrt, sympify
from sympy.matrices import MatrixBase
from sympy.stats import E, P, Bernoulli, Binomial, Exponential, Geometric, Normal, Poisson, Uniform, density, std
from sympy.stats import median as rv_median
from sympy.stats import variance as rv_variance
from sympy.stats.rv import is_random

DISTRIBUTIONS = (Bernoulli, Binomial, Geometric, Poisson, Uniform, Exponential, Normal)


def _values(args, at_least=1):
    if len(args) == 1 and isinstance(args[0], (list, tuple, set, frozenset, MatrixBase)):
        args = list(args[0])
    values = [sympify(v) for v in args]
    if len(values) < at_least:
        raise ValueError(f"needs at least {at_least} value{'s' if at_least > 1 else ''}")
    return values


def _or_random(of_random):
    """The function as it is for values, or of_random for a random variable (or an expression in them)."""
    def decorate(fn):
        @functools.wraps(fn)
        def wrapper(*xs):
            if len(xs) == 1 and isinstance(xs[0], Basic) and is_random(xs[0]):
                return of_random(xs[0])
            return fn(*xs)

        return wrapper

    return decorate


@_or_random(E)
def mean(*xs):
    """Arithmetic mean: mean([1, 2, 3, 4]) -> 5/2; of a random variable, its expectation"""
    values = _values(xs)
    return Add(*values) / len(values)


@_or_random(rv_median)
def median(*xs):
    """Middle value (mean of the two middle ones for an even count): median([3, 1, 4, 1]) -> 2"""
    values = sorted(_values(xs))
    mid = len(values) // 2
    return values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2


def _sum_of_squares(values):
    m = mean(values)
    return Add(*[(v - m) ** 2 for v in values])


@_or_random(rv_variance)
def variance(*xs):
    """Sample variance (divides by n - 1): variance([1, 2, 3, 4]) -> 5/3"""
    values = _values(xs, at_least=2)
    return _sum_of_squares(values) / (len(values) - 1)


@_or_random(std)
def stdev(*xs):
    """Sample standard deviation: stdev([1, 2, 3, 4]) -> sqrt(15)/3"""
    return sqrt(variance(*xs))


@_or_random(rv_variance)
def pvariance(*xs):
    """Population variance (divides by n): pvariance([1, 2, 3, 4]) -> 5/4"""
    values = _values(xs)
    return _sum_of_squares(values) / len(values)


@_or_random(std)
def pstdev(*xs):
    """Population standard deviation: pstdev([1, 2, 3, 4]) -> sqrt(5)/2"""
    return sqrt(pvariance(*xs))


def pdf(X, x):
    """P(X = x) for a discrete X (its p.m.f.), the density at x for a continuous one: pdf(Poisson("X", 4), 1) -> 4*exp(-4)"""
    d = density(X)
    return d.get(sympify(x), S.Zero) if isinstance(d, dict) else d(x)  # a finite one's (Binomial) is a dict


def cdf(X, x):
    """P(X <= x): cdf(Poisson("X", 4), 2) -> 13*exp(-4)"""
    return P(X <= x)


FUNCTIONS = {
    **{f.__name__: f for f in (mean, median, variance, stdev, pvariance, pstdev, pdf, cdf, *DISTRIBUTIONS)},
    "P": P,  # sympy.stats' probability
}
