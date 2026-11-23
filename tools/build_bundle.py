"""
Builds the precompiled bytecode the browser loads instead of Pyodide's source packages.

Pyodide ships packages as source, which Python compiles every time they're imported:
most of the startup time, and most of the first plot's. This compiles them once, at
deploy time, from the exact wheels Pyodide ships (PYODIDE_VERSION in worker.js), with
docstrings and asserts stripped (-OO). Three zips:

- sympy-bytecode.zip: SymPy and mpmath, imported straight from the zip (zipimport)
  instead of Pyodide's packages. ~5x faster import for ~3 MB more download.
- sympy-docs.zip: the docstrings sympy-bytecode.zip leaves out (~1.7 MB more if it kept
  them), fetched on the first help() and put back by py/calc/docs.py.
- plot-bytecode.zip: matplotlib and its dependencies, fetched on the first plot. These
  have compiled extension modules, which can't load from a zip, so Pyodide still
  installs the packages; this zip only holds __pycache__/*.pyc files, unpacked over
  them, which Python then uses instead of compiling the sources.

Bytecode is specific to a Python minor version, so this must run on the same one as
Pyodide (checked against pyodide-lock.json).

    uv run python tools/build_bundle.py [directory]
"""
import ast
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


def docstrings(source):
    """What -OO strips from a module, by qualified name ("" for the module's own): the
    docstrings of its classes, functions and methods. Not those of functions defined
    inside functions, which help() can't reach by name."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        tree = ast.parse(source)
    found = {}
    if doc := ast.get_docstring(tree):
        found[""] = doc

    def walk(body, prefix):
        for node in body:
            if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                name = prefix + node.name
                if doc := ast.get_docstring(node):
                    found[name] = doc
                if isinstance(node, ast.ClassDef):
                    walk(node.body, f"{name}.")
            else:  # if/try/with blocks: what they define is still the module's or the class's
                for field in ("body", "orelse", "handlers", "finalbody"):
                    walk(getattr(node, field, []), prefix)

    walk(tree.body, "")
    return found


def module_name(path):
    """sympy/stats/__init__.py -> sympy.stats"""
    return path.removesuffix(".py").removesuffix("/__init__").replace("/", ".")


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


def build_sympy(base, lock, output, docs_output):
    """SymPy and mpmath as a zip to import from: .pyc in place of each .py, plus data files.
    And the docstrings the .pyc leave out, as a zip of their own: a JSON per module
    ({qualified name: docstring}), named after it (sympy.stats.drv_types.json)."""
    with (
        zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle,
        zipfile.ZipFile(docs_output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as docs,
    ):
        for package, wheel in wheels(base, lock, SYMPY_PACKAGES):
            for name in wheel.namelist():
                if name.split("/")[0] != package or name.endswith("/"):
                    continue  # skip .dist-info
                data = wheel.read(name)
                if name.endswith(".py"):
                    bundle.writestr(name[:-3] + ".pyc", pyc(data, name))
                    if "tests" not in name.split("/") and (found := docstrings(data)):
                        docs.writestr(f"{module_name(name)}.json", json.dumps(found, ensure_ascii=False))
                else:
                    bundle.writestr(name, data)  # data files
    for path in (output, docs_output):
        print(f"{path}: {Path(path).stat().st_size / 1e6:.2f} MB", file=sys.stderr)


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
    build_sympy(base, lock, Path(directory) / "sympy-bytecode.zip", Path(directory) / "sympy-docs.zip")
    build_plot(base, lock, Path(directory) / "plot-bytecode.zip")


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else ROOT)
