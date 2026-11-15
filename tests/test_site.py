"""The deploy (.github/workflows/pages.yml) copies only the files it names and stamps
index.html's local scripts and stylesheets with the commit: a file index.html loads must
be in both, or the site breaks (or serves it stale) only once it's published."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = (ROOT / ".github/workflows/pages.yml").read_text()
INDEX = (ROOT / "index.html").read_text()
LOCAL = [ref for ref in re.findall(r'(?:src|href)="([^"]+)"', INDEX) if not re.match(r"[a-z]+:", ref)]


def test_index_loads_local_files():
    assert {"app.js", "app.css", "keypad.js", "touch.css"} <= set(LOCAL)


def test_deploy_copies_what_index_loads():
    copied = re.search(r"^\s*cp (index\.html .*) _site/$", WORKFLOW, re.M)[1].split()
    assert sorted(set(LOCAL) - set(copied)) == []
    assert all((ROOT / name).exists() for name in copied)


def test_deploy_stamps_what_index_loads():
    pattern, replacement = re.search(r"sed -i -E 's/(.+?)/(.+?)/' _site/index.html", WORKFLOW).groups()
    stamped = re.sub(pattern, replacement.replace("\\1", r"\g<1>").replace("\\2", r"\g<2>"), INDEX)
    for name in LOCAL:
        assert f'"{name}?v=${{{{ github.sha }}}}"' in stamped, name
