"""
Builds the precompiled bytecode the browser loads instead of Pyodide's source packages.

Pyodide ships packages as source, which Python compiles every time they're imported:
most of the startup time, and most of the first plot's. This compiles them once, at
deploy time, from the exact wheels Pyodide ships (PYODIDE_VERSION in worker.js), with
docstrings and asserts stripped (-OO). Two zips:

- sympy-bytecode.zip: SymPy and mpmath, imported straight from the zip (zipimport)
  instead of Pyodide's packages. ~5x faster import for ~3 MB more download.
- plot-bytecode.zip: matplotlib and its dependencies, fetched on the first plot. These
  have compiled extension modules, which can't load from a zip, so Pyodide still
  installs the packages; this zip only holds __pycache__/*.pyc files, unpacked over
  them, which Python then uses instead of compiling the sources.

Bytecode is specific to a Python minor version, so this must run on the same one as
Pyodide (checked against pyodide-lock.json).

    uv run python tools/build_bundle.py [directory]
"""
import importlib.util
import io
import json
import marshal
import re
import sys
import urllib.request
import warnings
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYMPY_PACKAGES = ("sympy", "mpmath")
PLOT_PACKAGE = "matplotlib"  # and everything it depends on


def pyodide_url():
    version = re.search(r'PYODIDE_VERSION = "([^"]+)"', (ROOT / "worker.js").read_text())[1]
    return f"https://cdn.jsdelivr.net/pyodide/v{version}/full/"


def fetch(url):
    with urllib.request.urlopen(url) as response:
        return response.read()


def pyc(source, filename):
    """A .pyc that loads without its source: header (magic, unchecked-hash flags, hash)
    + code. Unchecked is the only mode that loads sourceless, and next to a source it
    skips hashing the source on every import."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # sympy's own SyntaxWarnings (return in finally)
        code = compile(source, filename, "exec", optimize=2, dont_inherit=True)
    return importlib.util.MAGIC_NUMBER + (0b01).to_bytes(4, "little") + bytes(8) + marshal.dumps(code)


def dependencies(lock, package):
    found = [package]
    for name in found:
        found += [dep for dep in lock["packages"][name]["depends"] if dep not in found]
    return found


def wheels(base, lock, packages):
    for package in packages:
        info = lock["packages"][package]
        print(f"{package} {info['version']}", file=sys.stderr)
        yield package, zipfile.ZipFile(io.BytesIO(fetch(base + info["file_name"])))


def build_sympy(base, lock, output):
    """SymPy and mpmath as a zip to import from: .pyc in place of each .py, plus data files."""
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for package, wheel in wheels(base, lock, SYMPY_PACKAGES):
            for name in wheel.namelist():
                if name.split("/")[0] != package or name.endswith("/"):
                    continue  # skip .dist-info
                data = wheel.read(name)
                if name.endswith(".py"):
                    bundle.writestr(name[:-3] + ".pyc", pyc(data, name))
                else:
                    bundle.writestr(name, data)  # data files
    print(f"{output}: {Path(output).stat().st_size / 1e6:.2f} MB", file=sys.stderr)


def build_plot(base, lock, output):
    """matplotlib and its dependencies' bytecode, laid out as site-packages' __pycache__
    directories (relative to site-packages), to unpack over the installed packages."""
    tag = sys.implementation.cache_tag
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for _, wheel in wheels(base, lock, dependencies(lock, PLOT_PACKAGE)):
            for name in wheel.namelist():
                parts = name.split("/")
                if not name.endswith(".py") or ".dist-info" in parts[0] or "tests" in parts:
                    continue
                directory, _, file = name.rpartition("/")
                cached = f"{directory}/__pycache__/{file[:-3]}.{tag}.pyc".lstrip("/")
                bundle.writestr(cached, pyc(wheel.read(name), name))
    print(f"{output}: {Path(output).stat().st_size / 1e6:.2f} MB", file=sys.stderr)


def build(directory):
    base = pyodide_url()
    lock = json.loads(fetch(base + "pyodide-lock.json"))
    pyodide_python = lock["info"]["python"]
    if tuple(map(int, pyodide_python.split(".")[:2])) != sys.version_info[:2]:
        sys.exit(f"Pyodide runs Python {pyodide_python}, this is {sys.version.split()[0]}: bytecode wouldn't load")
    build_sympy(base, lock, Path(directory) / "sympy-bytecode.zip")
    build_plot(base, lock, Path(directory) / "plot-bytecode.zip")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else ROOT)
