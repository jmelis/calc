"""worker.js copies py/calc/ into Pyodide file by file: the list must be complete."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_worker_loads_every_module():
    listed = json.loads(re.search(r"const PY_FILES = (\[.*?\]);", (ROOT / "worker.js").read_text())[1])
    assert sorted(listed) == sorted(p.name for p in (ROOT / "py/calc").glob("*.py"))
