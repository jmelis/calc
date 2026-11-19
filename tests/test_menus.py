"""menus.json, the keypad's soft menus (keypad.js reads it in the page): every name in a menu
must be something keypad.js can show, and every function it inserts must exist, so a
typo fails here rather than as a dead soft key."""
import builtins
import json
import re
from pathlib import Path

import pytest

from calc.session import Session

ROOT = Path(__file__).resolve().parent.parent
MENUS = json.loads((ROOT / "menus.json").read_text())
VIEWS = {"vars", "catalog", "help", "setup", "abc"}  # keypad.js's VIEW_ITEMS
OPENED_BY_KEYS = {"trig", "hyp", "test", "chars"}  # the trig key, shift trig, shift =, shift alpha
KEY_FIELDS = {"label", "tex", "insert", "math"}
NS = Session().ns


def all_menus():
    return {"top": MENUS["top"], **MENUS["menus"]}


def names_in_menus():
    return sorted({name for rows in all_menus().values() for row in rows for name in row if name is not None})


@pytest.mark.parametrize("name, rows", all_menus().items())
def test_a_menu_is_rows_of_up_to_five(name, rows):
    assert rows and all(isinstance(row, list) and 0 < len(row) <= 5 for row in rows), name
    assert all(item is None or isinstance(item, str) for row in rows for item in row), name


def test_the_keys_menus_exist():
    assert OPENED_BY_KEYS <= set(MENUS["menus"])


@pytest.mark.parametrize("name, key", MENUS["keys"].items())
def test_a_key_says_only_what_keypad_reads(name, key):
    assert set(key) <= KEY_FIELDS, name
    assert key.get("insert", "").count("|") <= 1, name


@pytest.mark.parametrize("name", names_in_menus())
def test_every_name_is_something_to_show(name):
    """A menu, a view, or a key whose function exists (a key without an entry inserts name(…))."""
    if name in all_menus() or name in VIEWS:
        return
    insert = MENUS["keys"].get(name, {}).get("insert", f"{name}(|)")
    called = re.match(r"(\w+)\(", insert)
    if called:
        assert called[1] in NS or hasattr(builtins, called[1]), f"{name} inserts {called[1]}(…), which isn't defined"


def test_every_key_is_in_a_menu():
    assert sorted(set(MENUS["keys"]) - set(names_in_menus())) == []
