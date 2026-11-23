.PHONY: serve test bundle

# The app is static files; any web server works. http://127.0.0.1:8000
serve: sympy-bytecode.zip
	@python3 -m http.server 8000 --bind 127.0.0.1

# SymPy and matplotlib precompiled for the browser (optional: without them the page
# uses Pyodide's source packages)
bundle: sympy-bytecode.zip
sympy-bytecode.zip: worker.js tools/build_bundle.py  # writes sympy-docs.zip and plot-bytecode.zip too
	@uv run python tools/build_bundle.py

test:
	@uv run pytest
