"""
Builds sympy-bytecode.zip: SymPy and mpmath precompiled to bytecode, for the browser.

Pyodide ships SymPy as source, which Python compiles on every page load: most of the
startup time. This compiles it once, at deploy time, from the exact wheels Pyodide
ships (PYODIDE_VERSION in worker.js), with docstrings and asserts stripped (-OO). That
imports ~5x faster for ~3 MB more download; the worker imports straight from the zip.

Bytecode is specific to a Python minor version, so this must run on the same one as
Pyodide (checked against pyodide-lock.json).

    uv run python tools/build_bundle.py [output.zip]
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
PACKAGES = ("sympy", "mpmath")


def pyodide_url():
    version = re.search(r'PYODIDE_VERSION = "([^"]+)"', (ROOT / "worker.js").read_text())[1]
    return f"https://cdn.jsdelivr.net/pyodide/v{version}/full/"


def fetch(url):
    with urllib.request.urlopen(url) as response:
        return response.read()


def pyc(source, filename):
    """A sourceless .pyc: header (magic, unchecked-hash flags, hash) + code. There's no
    source to check against, so unchecked is the only mode that loads."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # sympy's own SyntaxWarnings (return in finally)
        code = compile(source, filename, "exec", optimize=2, dont_inherit=True)
    return importlib.util.MAGIC_NUMBER + (0b01).to_bytes(4, "little") + bytes(8) + marshal.dumps(code)


def build(output):
    base = pyodide_url()
    lock = json.loads(fetch(base + "pyodide-lock.json"))
    pyodide_python = lock["info"]["python"]
    if tuple(map(int, pyodide_python.split(".")[:2])) != sys.version_info[:2]:
        sys.exit(f"Pyodide runs Python {pyodide_python}, this is {sys.version.split()[0]}: bytecode wouldn't load")

    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for package in PACKAGES:
            wheel = zipfile.ZipFile(io.BytesIO(fetch(base + lock["packages"][package]["file_name"])))
            for name in wheel.namelist():
                if name.split("/")[0] != package or name.endswith("/"):
                    continue  # skip .dist-info
                data = wheel.read(name)
                if name.endswith(".py"):
                    bundle.writestr(name[:-3] + ".pyc", pyc(data, name))
                else:
                    bundle.writestr(name, data)  # data files
            print(f"{package} {lock['packages'][package]['version']}: compiled", file=sys.stderr)
    print(f"{output}: {Path(output).stat().st_size / 1e6:.2f} MB", file=sys.stderr)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else ROOT / "sympy-bytecode.zip")
