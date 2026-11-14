"""
sympy-bytecode.zip (tools/build_bundle.py): SymPy and mpmath load from it, docstrings
stripped and all, and the calculator works on top. Skipped until it's built
(make bundle); CI builds it before the tests.
"""
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "sympy-bytecode.zip"
pytestmark = pytest.mark.skipif(not BUNDLE.exists(), reason="sympy-bytecode.zip isn't built (make bundle)")

CHECK = f"""
import sys
sys.path[:0] = [{str(BUNDLE)!r}, {str(ROOT / "py")!r}]
import mpmath, sympy
assert sympy.__file__.endswith(".pyc") and mpmath.__file__.endswith(".pyc"), (sympy.__file__, mpmath.__file__)
from calc.session import Session
s = Session()
for src, expected in [
    ("integrate(sin(x)^2, (x, 0, pi))", "pi/2"),
    ("dsolve(Derivative(f(x), x) - f(x), f(x))", "Eq(f(x), C1*exp(x))"),
    ("summation(1/k^2, (k, 1, oo))", "pi**2/6"),
    ("nsolve(cos(x) - x, x, 1)", "0.739085133215161"),
    ("sin(30°)", "1/2"),
]:
    payload = s.run(src, 1)
    assert payload.get("result", {{}}).get("text") == expected, (src, payload)
"""


def test_sympy_runs_from_the_bundle():
    result = subprocess.run([sys.executable, "-I", "-W", "ignore", "-c", CHECK], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
