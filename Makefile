.PHONY: serve test

# The app is static files; any web server works. http://127.0.0.1:8000
serve:
	@python3 -m http.server 8000 --bind 127.0.0.1

test:
	@uv run pytest
