"""The touch layout worked by its keys alone (keypad.mjs): settings, vars, the catalog and
help on the screen, as they'd have to work on a calculator with no touch screen. Needs
node with Playwright and its Chromium, and Pyodide from the CDN; skipped without them."""
import functools
import http.server
import shutil
import subprocess
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def _node_playwright():
    if shutil.which("node") is None:
        return False
    found = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True)
    return found.returncode == 0


pytestmark = pytest.mark.skipif(not _node_playwright(), reason="needs node with playwright")


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture
def site():
    """The repository served on a free port (not 8000: IndexedDB is per port)."""
    handler = functools.partial(_Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/"
    server.shutdown()


def test_views_work_by_keys_alone(site):
    run = subprocess.run(["node", str(ROOT / "tests/keypad.mjs"), site], capture_output=True, text=True, timeout=300)
    if run.returncode == 77:
        pytest.skip(f"Python didn't start in the page (offline?): {run.stdout.strip()}")
    assert run.returncode == 0, run.stdout + run.stderr
