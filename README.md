# calc

A keyboard-driven calculator with the full power of [SymPy](https://www.sympy.org), running entirely
in your browser through [Pyodide](https://pyodide.org). Exact results, typeset as you go.

**Try it: https://jmelis.github.io/calc/**

Type an expression and press <kbd>⏎</kbd>. Press <kbd>?</kbd> for the function catalog,
<kbd>↑</kbd> to pick earlier results, and <kbd>Ctrl</kbd>+<kbd>M</kbd> for typeset math input.
On a phone or tablet it shows a calculator keypad instead (`?layout=touch` or `?layout=desktop`
in the address picks one).

To run it locally: `make serve`, then open http://127.0.0.1:8000. Tests: `make test`.

MIT licensed.
