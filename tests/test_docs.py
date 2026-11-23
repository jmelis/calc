"""
help() in the browser: the bytecode bundle is built without docstrings (-OO), and
sympy-docs.zip puts them back. Checked here on a module compiled the same way;
test_bundle.py checks the real bundle.
"""
import json
import sys
import types
import zipfile
from pathlib import Path

import pytest

from calc import docs

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from build_bundle import docstrings, module_name  # noqa: E402

SOURCE = '''
"""The module."""
import functools


class A:
    """A class."""

    def method(self):
        """A method."""

    @classmethod
    def made(cls):
        """A classmethod."""

    @staticmethod
    def static():
        """A staticmethod."""

    @property
    def prop(self):
        """A property."""

    class Inner:
        """A nested class."""


def wrapped(fn):
    @functools.wraps(fn)
    def wrapper(*args):
        """Not reachable by name."""
        return fn(*args)

    return wrapper


@wrapped
def function():
    """A decorated function."""


if True:
    def conditional():
        """Defined in an if."""


def documented_at_runtime():
    """Stripped."""


documented_at_runtime.__doc__ = "Set at runtime."
'''

NAME = "calc_docs_sample"


def test_docstrings_by_qualified_name():
    assert docstrings(SOURCE) == {
        "": "The module.",
        "A": "A class.",
        "A.method": "A method.",
        "A.made": "A classmethod.",
        "A.static": "A staticmethod.",
        "A.prop": "A property.",
        "A.Inner": "A nested class.",
        "function": "A decorated function.",
        "conditional": "Defined in an if.",
        "documented_at_runtime": "Stripped.",
    }


def test_module_names():
    assert module_name("sympy/stats/drv_types.py") == "sympy.stats.drv_types"
    assert module_name("sympy/stats/__init__.py") == "sympy.stats"


@pytest.fixture
def stripped(tmp_path, monkeypatch):
    """The sample compiled as the bundle is (-OO), imported, with its docs zip loaded."""
    module = types.ModuleType(NAME)
    exec(compile(SOURCE, f"{NAME}.py", "exec", optimize=2), vars(module))
    monkeypatch.setitem(sys.modules, NAME, module)
    path = tmp_path / "docs.zip"
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr(f"{NAME}.json", json.dumps(docstrings(SOURCE)))
    for name, value in {"_docs": None, "_modules": set(), "_restored": set()}.items():
        monkeypatch.setattr(docs, name, value)
    docs.load(path)
    return module


def test_restore_puts_docstrings_back(stripped):
    A = stripped.A
    assert A.__doc__ is None and stripped.function.__doc__ is None
    docs.restore()
    assert stripped.__doc__ == "The module."
    assert A.__doc__ == "A class."
    assert A.method.__doc__ == "A method."
    assert A.made.__doc__ == "A classmethod."
    assert A.static.__doc__ == "A staticmethod."
    assert A.prop.__doc__ == "A property."
    assert A.Inner.__doc__ == "A nested class."
    assert stripped.function.__doc__ == "A decorated function."
    assert stripped.conditional.__doc__ == "Defined in an if."
    assert stripped.documented_at_runtime.__doc__ == "Set at runtime."  # what -OO kept stays


def test_help_restores_first(stripped, capsys):
    docs.help(stripped.A)
    assert "A classmethod." in capsys.readouterr().out
