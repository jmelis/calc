"""
The bundles tools/build_bundle.py builds. sympy-bytecode.zip: SymPy and mpmath load
from it, docstrings stripped and all, and the calculator works on top.
sympy-docs.zip: those docstrings, back for help().
plot-bytecode.zip: bytecode where Python looks for it next to installed sources.
Skipped until they're built (make bundle); CI builds them before the tests.
"""
import importlib.util
import marshal
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
BUNDLE = ROOT / "sympy-bytecode.zip"
DOCS = ROOT / "sympy-docs.zip"
PLOT_BUNDLE = ROOT / "plot-bytecode.zip"
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


HELP = f"""
import sys
sys.path[:0] = [{str(BUNDLE)!r}, {str(ROOT / "py")!r}]
from calc import docs
from calc.session import Session
s = Session()
help = lambda name: s.run(f"help({{name}})", 1)["outputs"][0]["text"]
assert "Poisson distribution" not in help("Poisson")  # stripped
docs.load({str(DOCS)!r})
assert "Create a discrete random variable with a Poisson distribution" in help("Poisson")
assert "Compute the factorization of expression" in help("factor")
assert "Return a list of real and complex roots with multiplicities" in help("Poly")  # a method's
"""


@pytest.mark.skipif(not DOCS.exists(), reason="sympy-docs.zip isn't built (make bundle)")
def test_docs_bring_back_docstrings():
    result = subprocess.run([sys.executable, "-I", "-W", "ignore", "-c", HELP], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_plot_bundle_is_pycache_for_site_packages():
    with zipfile.ZipFile(PLOT_BUNDLE) as bundle:
        names = bundle.namelist()
        tag = sys.implementation.cache_tag
        for name in ["matplotlib/__pycache__/pyplot", "numpy/__pycache__/__init__", "__pycache__/six"]:
            assert f"{name}.{tag}.pyc" in names
        assert all("/__pycache__/" in f"/{name}" and name.endswith(f".{tag}.pyc") for name in names)
        data = bundle.read(f"matplotlib/__pycache__/pyplot.{tag}.pyc")
    # loads without checking the source: this Python's magic, unchecked-hash flags
    assert data[:4] == importlib.util.MAGIC_NUMBER and int.from_bytes(data[4:8], "little") == 0b01
    assert hasattr(marshal.loads(data[16:]), "co_code")
