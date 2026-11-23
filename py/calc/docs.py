"""
help() with SymPy's docstrings, which the browser's bytecode bundle is built without
(tools/build_bundle.py): they'd make it ~1.7 MB bigger for everyone. sympy-docs.zip holds
them instead, a JSON per module ({qualified name: docstring}), and the worker fetches it
on the first help() and load()s it. help() then puts back the docstrings of the modules
imported so far, so Python's own help (and anything else reading __doc__) finds them.

Natively, or in the browser without the bundle, nothing is loaded and nothing is missing.
"""
import json
import pydoc
import sys
import zipfile

_docs = None  # sympy-docs.zip, once loaded
_modules = set()  # the modules it has docstrings for
_restored = set()


def load(path):
    global _docs, _modules
    _docs = zipfile.ZipFile(path)
    _modules = {name.removesuffix(".json") for name in _docs.namelist()}


def help(*args, **kwargs):
    """help(name): the documentation of a function, class or module, e.g. help(factor)"""
    restore()
    return pydoc.help(*args, **kwargs)


def restore():
    """Put back the docstrings of the modules imported since the last call."""
    for name in _modules.intersection(sys.modules) - _restored:
        _restored.add(name)
        module = sys.modules[name]
        for qualname, doc in json.loads(_docs.read(f"{name}.json")).items():
            _document(_find(module, qualname), doc)


def _find(module, qualname):
    """The object a qualified name names in its module, as defined there: a class's own
    classmethod or property, not what getattr would make of it."""
    obj = module
    for part in filter(None, qualname.split(".")):
        obj = vars(obj).get(part) if hasattr(obj, "__dict__") else None
    return obj


def _document(obj, doc):
    if isinstance(obj, (classmethod, staticmethod)):
        obj = obj.__func__
    if obj is None or getattr(obj, "__doc__", "") is not None:
        return  # gone, or it has one (set at runtime, or never stripped)
    try:
        obj.__doc__ = doc
    except (AttributeError, TypeError):
        pass  # one that can't be set
