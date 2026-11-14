// LaTeX -> calculator syntax, for the math input (see calc/parser.py for the syntax).
//
// Reads the LaTeX that reaches the math field from three places: what MathLive
// writes for typed input (\frac37, letters run together), what calc/preview.py
// renders when switching a text line to math, and what SymPy prints for results
// picked from the tape (\sin{\left(x \right)}, \left[\begin{matrix}...).
//
// Output only has to be something calc/parser.py reads the same way, so it is
// generous with parentheses and leaves implicit multiplication vs. function calls
// (x(y+1) vs f(y+1)) to the Python side, which knows which names are functions.

(function (root) {
  class LatexError extends Error {}

  const FUNCTIONS = {
    sin: "sin", cos: "cos", tan: "tan", cot: "cot", sec: "sec", csc: "csc",
    sinh: "sinh", cosh: "cosh", tanh: "tanh", coth: "coth",
    arcsin: "asin", arccos: "acos", arctan: "atan", asin: "asin", acos: "acos", atan: "atan",
    ln: "log", log: "log", exp: "exp", det: "det", gcd: "gcd", max: "Max", min: "Min",
  };
  const SYMBOLS = {
    pi: "pi", infty: "oo", imaginaryI: "I", exponentialE: "E", partial: "partial",
    lambda: "lamda", Lambda: "Lamda",
  };
  const GREEK = (
    "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa mu nu xi " +
    "omicron rho varrho sigma tau upsilon phi varphi chi psi omega " +
    "Gamma Delta Theta Xi Pi Sigma Upsilon Phi Psi Omega"
  ).split(" ");
  const RELATIONS = {
    "=": "=", coloneqq: "=", le: "<=", leq: "<=", ge: ">=", geq: ">=", ne: "!=", neq: "!=",
    lt: "<", gt: ">", "<": "<", ">": ">",
  };
  const PRODUCTS = { cdot: "*", times: "*", "*": "*", div: "/", "/": "/", bmod: "%" };
  const SPACES = new Set([",", ";", ":", "!", " ", "quad", "qquad", "displaystyle", "textstyle", "limits", "nolimits"]);
  const IGNORED_WRAPPERS = new Set(["mathit", "mathbf", "boldsymbol", "mathrm", "operatorname", "mathsf", "mathtt"]);

  // --- tokens: {t: "cmd" | "char" | "space", v} ---

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\\") {
        const m = src.slice(i + 1).match(/^([A-Za-z]+|.)/);
        if (!m) throw new LatexError("dangling backslash");
        tokens.push({ t: "cmd", v: m[1] });
        i += 1 + m[1].length;
      } else if (/\s/.test(ch) || ch === "~") {
        tokens.push({ t: "space" });
        while (i < src.length && /\s/.test(src[i])) i++;
        if (ch === "~") i++;
      } else {
        tokens.push({ t: "char", v: ch });
        i++;
      }
    }
    return tokens;
  }

  const isAtomic = (s) => /^[\w.$]+$/.test(s) || /^[\w.]*\((?:[^()]|\([^()]*\))*\)$/.test(s) && balanced(s);
  const paren = (s) => (isAtomic(s) ? s : `(${s})`);

  function balanced(s) {
    // "(a)+(b)" matches the call-ish regex above but isn't one atom
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "(") depth++;
      else if (s[i] === ")" && --depth === 0 && i !== s.length - 1) return false;
    }
    return true;
  }

  class Parser {
    constructor(tokens) {
      this.tokens = tokens;
      this.i = 0;
    }

    peek(offset = 0) {
      return this.tokens[this.i + offset];
    }

    next() {
      return this.tokens[this.i++];
    }

    skipSpaces() {
      while (this.isSpace(this.peek())) this.i++;
    }

    isSpace(tok) {
      return tok && (tok.t === "space" || (tok.t === "cmd" && SPACES.has(tok.v)));
    }

    isChar(tok, chars) {
      return tok && tok.t === "char" && chars.includes(tok.v);
    }

    isCmd(tok, names) {
      return tok && tok.t === "cmd" && (typeof names === "string" ? tok.v === names : names.includes(tok.v));
    }

    expect(pred, what) {
      this.skipSpaces();
      const tok = this.next();
      if (!tok || !pred(tok)) throw new LatexError(`expected ${what}`);
      return tok;
    }

    atEnd(stops) {
      this.skipSpaces();
      const tok = this.peek();
      if (!tok) return true;
      if (tok.t === "char" && "})]&,".includes(tok.v)) return true;
      if (this.isChar(tok, ":") && !this.isChar(this.peek(1), "=")) return true;
      if (this.isCmd(tok, ["right", "end", "\\"])) return true;
      if (this.isChar(tok, "|") && stops.bar) return true;
      return false;
    }

    // --- grammar ---

    // items separated by commas/colons, as in function arguments, lists, dicts
    list(stops = {}) {
      const items = [this.relation(stops)];
      const seps = [];
      for (;;) {
        this.skipSpaces();
        if (this.isChar(this.peek(), ",")) {
          this.next();
          seps.push(", ");
        } else if (this.isChar(this.peek(), ":") && !this.isChar(this.peek(1), "=")) {
          this.next();
          seps.push(": ");
        } else break;
        items.push(this.relation(stops));
      }
      return items.reduce((out, item, k) => out + (k ? seps[k - 1] : "") + item, "");
    }

    relation(stops = {}) {
      let out = this.sum(stops);
      for (;;) {
        this.skipSpaces();
        const tok = this.peek();
        if (this.isChar(tok, ":") && this.isChar(this.peek(1), "=")) this.next(); // a := 10
        const op = tok && (tok.t === "char" || tok.t === "cmd") ? RELATIONS[this.peek().v] : undefined;
        if (!op) return out;
        this.next();
        out = `${out} ${op} ${this.sum(stops)}`;
      }
    }

    sum(stops = {}) {
      this.skipSpaces();
      let out = "";
      if (this.isChar(this.peek(), "+-")) out = this.next().v === "-" ? "-" : "";
      if (this.atEnd(stops)) {
        if (out) throw new LatexError("dangling sign");
        return "";
      }
      out += this.term(stops);
      for (;;) {
        this.skipSpaces();
        if (!this.isChar(this.peek(), "+-")) return out;
        const op = this.next().v;
        out += ` ${op} ${this.term(stops)}`;
      }
    }

    // products, explicit or implied by juxtaposition: 2x, x \sin x, \frac12 x
    term(stops = {}) {
      let out = this.factor(stops);
      for (;;) {
        if (stops.differential && this.differential()) return out;
        if (this.atEnd(stops)) return out;
        const tok = this.peek();
        const op = tok.t === "cmd" || tok.t === "char" ? PRODUCTS[tok.v] : undefined;
        if (op) {
          this.next();
          out = `${out}${op}${this.factor(stops)}`;
        } else if (this.startsFactor(tok)) {
          // juxtaposition: a space, so Python decides between 2 x, sin x and f x
          out = `${out} ${this.factor(stops)}`;
        } else return out;
      }
    }

    startsFactor(tok) {
      if (tok.t === "char") return /[\w.({[|#!']/.test(tok.v) && tok.v !== "!";
      if (tok.v === "degree") return false;
      return !(tok.v in RELATIONS) && !(tok.v in PRODUCTS) && !["right", "end", "to"].includes(tok.v);
    }

    // \, dx  /  \mathrm{d}x  /  dx at the end of an integrand: returns the variable
    differential() {
      const save = this.i;
      this.skipSpaces();
      const tok = this.peek();
      if (this.isCmd(tok, "mathrm") || this.isCmd(tok, "operatorname")) {
        const inner = this.tokens[this.i + 2];
        if (this.isChar(this.tokens[this.i + 1], "{") && this.isChar(inner, "d") && this.isChar(this.tokens[this.i + 3], "}")) {
          this.i += 4;
          this.skipSpaces();
          this.pendingDifferential = this.identifier();
          return true;
        }
      }
      if (this.isChar(tok, "d")) {
        const after = this.tokens[this.i + 1];
        if (after && ((after.t === "char" && /[A-Za-z]/.test(after.v)) || (after.t === "cmd" && GREEK.includes(after.v)))) {
          this.i++;
          this.pendingDifferential = this.identifier();
          return true;
        }
      }
      this.i = save;
      return false;
    }

    factor(stops = {}) {
      let out = this.postfix(this.primary(stops), stops);
      return out;
    }

    postfix(base, stops = {}) {
      for (;;) {
        const tok = this.peek();
        if (this.isChar(tok, "!")) {
          this.next();
          base = `${paren(base)}!`;
        } else if (this.isChar(tok, "°º") || this.isCmd(tok, "degree")) {
          this.next();
          base = `${paren(base)}°`;
        } else if (this.isChar(tok, "^") && this.isDegree(1)) {
          this.i += this.isCmd(this.peek(1), "circ") ? 2 : 4; // ^\circ or ^{\circ}
          base = `${paren(base)}°`;
        } else if (this.isChar(tok, "^")) {
          this.next();
          const side = this.oneSided();
          base = side ? `${base}${side}` : `${paren(base)}^${paren(this.argument())}`;
        } else if (this.isChar(tok, "_")) {
          this.next();
          base = `${base}_${this.argument().replace(/[^\w]/g, "")}`;
        } else if (this.isChar(tok, "'")) {
          throw new LatexError("primes (f') aren't supported; use diff");
        } else return base;
      }
    }

    // ^\circ or ^{\circ} after a value: degrees
    isDegree(offset) {
      const t = this.peek(offset);
      if (this.isCmd(t, "circ")) return true;
      return this.isChar(t, "{") && this.isCmd(this.peek(offset + 1), "circ") && this.isChar(this.peek(offset + 2), "}");
    }

    // a^+ / a^{-} in a limit's subscript: marks the side instead of a power
    oneSided() {
      const t = (k) => this.peek(k);
      if (this.isChar(t(0), "+-")) return this.next().v === "+" ? "⁺" : "⁻";
      if (this.isChar(t(0), "{") && this.isChar(t(1), "+-") && this.isChar(t(2), "}")) {
        this.next();
        const sign = this.next().v;
        this.next();
        return sign === "+" ? "⁺" : "⁻";
      }
      return null;
    }

    // argument of ^, _, \frac, \sqrt: a {group} or a single token
    argument() {
      this.skipSpaces();
      const tok = this.peek();
      if (!tok) throw new LatexError("missing argument");
      if (this.isChar(tok, "{")) return this.braced();
      this.next();
      if (tok.t === "char") return tok.v;
      return this.command(tok, {}, true);
    }

    braced(stops = {}) {
      this.expect((t) => this.isChar(t, "{"), "{");
      const inner = this.list(stops);
      this.expect((t) => this.isChar(t, "}"), "}");
      return inner;
    }

    primary(stops = {}) {
      this.skipSpaces();
      const tok = this.peek();
      if (!tok) throw new LatexError("unexpected end");
      if (tok.t === "char") {
        if (/[0-9.]/.test(tok.v)) return this.number();
        if (/[A-Za-z]/.test(tok.v)) {
          const name = this.identifier(stops);
          // a lone i is the imaginary unit, as on calculators (SymPy prints I as i too)
          return name === "i" ? "I" : this.call(name, stops);
        }
        if (tok.v === "{") return this.call(paren(this.braced()), stops);
        if (tok.v === "(" || tok.v === "[") return this.call(this.bracket(tok.v), stops);
        if (tok.v === "|") {
          this.next();
          const inner = this.list({ bar: true });
          this.expect((t) => this.isChar(t, "|"), "|");
          return `abs(${inner})`;
        }
        if (tok.v === "#") {
          this.next();
          return `$${this.number()}`;
        }
        throw new LatexError(`unexpected "${tok.v}"`);
      }
      this.next();
      return this.command(tok, stops, false);
    }

    number() {
      let out = "";
      while (this.isChar(this.peek(), "0123456789.")) out += this.next().v;
      // MathLive may write a decimal comma as {,}
      return out;
    }

    // a run of letters and digits typed together (solve, x2), or a Greek letter
    identifier(stops = {}) {
      const tok = this.peek();
      if (tok.t === "cmd") {
        this.next();
        return GREEK.includes(tok.v) ? tok.v : SYMBOLS[tok.v] ?? tok.v;
      }
      const letter = (k) => {
        const t = this.peek(k);
        return t && t.t === "char" && /[A-Za-z0-9]/.test(t.v);
      };
      let out = "";
      while (letter(0)) {
        // inside an integrand, "xdx" typed in one go ends with its differential
        if (stops.differential && out && this.peek().v === "d" && letter(1) && !letter(2)) break;
        out += this.next().v;
      }
      return out;
    }

    // name followed directly by a bracket: f(x), solve(...); x(y+1) is left for Python to read as x*(y+1)
    call(head, stops) {
      const tok = this.peek();
      if (!/^[A-Za-z_]\w*$/.test(head)) return head;
      if (this.isChar(tok, "{") && this.isCmd(this.peek(1), "left")) {
        // sympy: \operatorname{f}{\left(x \right)}
        return `${head}(${this.braced().replace(/^\((.*)\)$/s, "$1")})`;
      }
      if (this.isChar(tok, "(") || this.isCmd(tok, "left")) {
        const save = this.i;
        if (this.isCmd(tok, "left") && !this.isChar(this.peek(1), "(")) return head;
        const args = this.isChar(tok, "(") ? this.bracket("(") : this.left();
        if (!args.startsWith("(")) {
          this.i = save;
          return head;
        }
        return `${head}${args}`;
      }
      return head;
    }

    bracket(open) {
      const close = { "(": ")", "[": "]" }[open];
      this.next();
      const inner = this.list();
      this.expect((t) => this.isChar(t, close), close);
      return open === "(" ? `(${inner})` : `[${inner}]`;
    }

    // \left( ... \right) and friends
    left() {
      this.expect((t) => this.isCmd(t, "left"), "\\left");
      this.skipSpaces();
      const open = this.next();
      const delim = open.t === "cmd" ? open.v : open.v; // "(", "[", "|", "{" (as \{), "lbrack", "."
      this.skipSpaces();
      // sympy: \left[\begin{matrix}..\end{matrix}\right] is a single Matrix
      if ((delim === "[" || delim === "lbrack") && this.isCmd(this.peek(), "begin")) {
        const save = this.i;
        const m = this.environment();
        this.skipSpaces();
        if (this.isCmd(this.peek(), "right")) {
          this.closeLeft();
          return m;
        }
        this.i = save;
      }
      const inner = delim === "|" ? this.list({ bar: true }) : this.list();
      this.closeLeft();
      if (delim === "(" ) return `(${inner})`;
      if (delim === "[" || delim === "lbrack") return `[${inner}]`;
      if (delim === "|" || delim === "vert" || delim === "lvert") return `abs(${inner})`;
      if (delim === "{" || delim === "lbrace") return `{${inner}}`;
      if (delim === ".") return `(${inner})`;
      throw new LatexError(`unsupported delimiter \\left${delim}`);
    }

    closeLeft() {
      this.expect((t) => this.isCmd(t, "right"), "\\right");
      this.skipSpaces();
      this.next(); // the closing delimiter
    }

    environment() {
      this.expect((t) => this.isCmd(t, "begin"), "\\begin");
      const name = this.rawGroup();
      if (name === "cases") return this.cases();
      if (!/^[pbvBV]?matrix\*?$|^array$/.test(name)) throw new LatexError(`unsupported environment ${name}`);
      if (name === "array") this.rawGroup(); // column spec
      const rows = [[]];
      for (;;) {
        this.skipSpaces();
        if (this.isCmd(this.peek(), "end")) break;
        rows[rows.length - 1].push(this.list());
        this.skipSpaces();
        const tok = this.next();
        if (this.isChar(tok, "&")) continue;
        if (this.isCmd(tok, "\\")) rows.push([]);
        else if (this.isCmd(tok, "end")) {
          this.i--;
          break;
        } else throw new LatexError("bad matrix");
      }
      this.next();
      this.rawGroup();
      const cleaned = rows.filter((r) => r.some((c) => c !== ""));
      return `Matrix([${cleaned.map((r) => `[${r.join(", ")}]`).join(", ")}])`;
    }

    // sympy: \begin{cases} x & \text{for}\: x > 0 \\ 0 & \text{otherwise} \end{cases}
    cases() {
      const pieces = [];
      for (;;) {
        this.skipSpaces();
        if (this.isCmd(this.peek(), "end")) break;
        const value = this.list();
        this.expect((t) => this.isChar(t, "&"), "&");
        this.skipSpaces();
        let condition;
        if (this.isCmd(this.peek(), "text")) {
          this.next();
          const word = this.rawGroup();
          condition = word === "otherwise" ? "True" : this.list();
        } else condition = this.list();
        pieces.push(`(${value}, ${condition})`);
        this.skipSpaces();
        if (this.isCmd(this.peek(), "\\")) this.next();
      }
      this.next();
      this.rawGroup();
      return `Piecewise(${pieces.join(", ")})`;
    }

    rawGroup() {
      this.expect((t) => this.isChar(t, "{"), "{");
      let out = "";
      let depth = 0;
      while (depth > 0 || !this.isChar(this.peek(), "}")) {
        const tok = this.next();
        if (!tok) throw new LatexError("unclosed {");
        if (this.isChar(tok, "{")) depth++;
        else if (this.isChar(tok, "}")) depth--;
        out += tok.t === "cmd" ? `\\${tok.v}` : tok.t === "space" ? " " : tok.v;
      }
      this.next();
      return out.trim();
    }

    command(tok, stops, asArgument) {
      const name = tok.v;
      if (name === "placeholder") {
        if (this.isChar(this.peek(), "[")) while (!this.isChar(this.next(), "]"));
        this.rawGroup();
        throw new LatexError("fill in the empty boxes first");
      }
      if (name in FUNCTIONS) return this.func(FUNCTIONS[name], name === "log");
      if (name === "Gamma" && (this.isChar(this.peek(), "(") || this.isCmd(this.peek(), "left") || this.isChar(this.peek(), "{"))) {
        return this.func("gamma", false); // \Gamma(5) is the gamma function, as sympy prints it
      }
      if (GREEK.includes(name)) return this.call(name, stops);
      if (name === "binom") return `binomial(${this.argument()}, ${this.argument()})`;
      if (name in SYMBOLS) return SYMBOLS[name];
      if (name === "frac" || name === "dfrac" || name === "tfrac") return this.frac(stops);
      if (name === "sqrt") {
        let index = null;
        this.skipSpaces();
        if (this.isChar(this.peek(), "[")) {
          this.next();
          index = this.list();
          this.expect((t) => this.isChar(t, "]"), "]");
        }
        const radicand = this.argument();
        return index === null ? `sqrt(${radicand})` : `root(${radicand}, ${index})`;
      }
      if (name === "left") {
        this.i--;
        return this.left();
      }
      if (name === "begin") {
        this.i--;
        return this.environment();
      }
      if (name === "boxed") return `$${this.rawGroup()}`;
      if (name === "#") return `$${this.number()}`;
      if (name === "text" || name === "textrm" || name === "mathrm" && false) return this.rawGroup();
      if (IGNORED_WRAPPERS.has(name)) {
        // MathLive nests them: \operatorname{\mathrm{factor}}
        const inner = this.rawGroup().replace(/\\(?:mathrm|mathit|mathbf|text)\{([^{}]*)\}/g, "$1");
        if (name === "mathrm" && inner === "d") return "d";
        if (name === "mathrm" && inner === "e") return "E";
        if (inner in FUNCTIONS) return this.func(FUNCTIONS[inner], inner === "log");
        return this.call(inner.replace(/\s+/g, ""), stops);
      }
      if (name === "tilde") {
        const inner = this.argument();
        if (inner === "oo") return "zoo";
        throw new LatexError("unsupported \\tilde");
      }
      if (name === "int") return this.integral();
      if (name === "sum") return this.bigOperator("summation");
      if (name === "prod") return this.bigOperator("product");
      if (name === "lim") return this.limit();
      if (name === "lbrack") {
        const inner = this.list();
        this.expect((t) => this.isCmd(t, "rbrack") || this.isChar(t, "]"), "]");
        return `[${inner}]`;
      }
      if (name === "{") {
        const inner = this.list();
        this.expect((t) => this.isCmd(t, "}"), "\\}");
        return `{${inner}}`;
      }
      if (asArgument) throw new LatexError(`unsupported \\${name}`);
      throw new LatexError(`unsupported \\${name}`);
    }

    // \sin x, \sin^{2}\left(x\right), sympy's \sin{\left(x \right)}, \log_{2}(8)
    func(name, allowBase) {
      let power = null;
      let base = null;
      for (;;) {
        const tok = this.peek();
        if (this.isChar(tok, "^")) {
          this.next();
          power = this.argument();
        } else if (this.isChar(tok, "_") && allowBase) {
          this.next();
          base = this.argument();
        } else break;
      }
      this.skipSpaces();
      const tok = this.peek();
      let arg;
      if (this.isChar(tok, "{") || this.isChar(tok, "(") || this.isCmd(tok, "left")) {
        arg = this.isChar(tok, "{") ? this.braced() : this.isChar(tok, "(") ? this.bracket("(") : this.left();
        arg = arg.replace(/^\((.*)\)$/s, "$1");
      } else {
        arg = this.postfix(this.primary());
      }
      const call = base === null ? `${name}(${arg})` : `${name}(${arg}, ${base})`;
      return power === null ? call : `${call}^${paren(power)}`;
    }

    frac(stops) {
      const num = this.argument();
      const den = this.argument();
      // d/dx, d^2/dx^2, ∂²/∂x∂y followed by what's differentiated
      const d = num.match(/^(d|partial)(?:\^\(?(\d+)\)?)?$/);
      if (d) {
        const vars = den.split(/[\s*]?(?:d|partial)[\s*]?/).map((v) => v.replace(/[\s*()]/g, "")).filter(Boolean);
        const single = den.match(/^d[\s*]?([A-Za-z]\w*)(?:\^\(?(\d+)\)?)?$/);
        if (single || vars.length) {
          const body = this.term(stops);
          if (single) return `diff(${body}, ${single[1]}${single[2] ? `, ${single[2]}` : ""})`;
          return `diff(${body}, ${vars.map((v) => v.replace(/\^\(?(\d+)\)?$/, ", $1")).join(", ")})`;
        }
      }
      return `(${paren(num)}/${paren(den)})`;
    }

    // \int f\,dx, \int_a^b f\,dx; nested integrals each take their own differential
    integral() {
      const { lower, upper } = this.limits();
      const body = this.term({ differential: true });
      const variable = this.pendingDifferential;
      this.pendingDifferential = null;
      if (!variable) throw new LatexError("an integral needs its dx");
      if (lower === null && upper === null) return `integrate(${body}, ${variable})`;
      if (lower === null || upper === null) throw new LatexError("a definite integral needs both bounds");
      return `integrate(${body}, (${variable}, ${lower}, ${upper}))`;
    }

    limits() {
      let lower = null;
      let upper = null;
      for (;;) {
        this.skipSpaces();
        const tok = this.peek();
        if (this.isChar(tok, "_")) {
          this.next();
          lower = this.argument();
        } else if (this.isChar(tok, "^")) {
          this.next();
          upper = this.argument();
        } else return { lower, upper };
      }
    }

    // \sum_{k=1}^{n} f -> summation(f, (k, 1, n))
    bigOperator(fn) {
      const { lower, upper } = this.limits();
      const m = lower && lower.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.+)$/);
      if (!m || upper === null) throw new LatexError(`${fn} needs bounds like k=1 and n`);
      const body = this.term();
      return `${fn}(${body}, (${m[1]}, ${m[2]}, ${upper}))`;
    }

    // \lim_{x \to a} f, with a^+ / a^- for one-sided limits
    limit() {
      this.skipSpaces();
      if (!this.isChar(this.peek(), "_")) throw new LatexError("\\lim needs x \\to a below it");
      this.next();
      this.expect((t) => this.isChar(t, "{"), "{");
      this.skipSpaces();
      const variable = this.identifier();
      this.expect((t) => this.isCmd(t, ["to", "rightarrow"]), "\\to");
      let point = this.list();
      this.expect((t) => this.isChar(t, "}"), "}");
      let direction = "";
      const sided = point.match(/^(.*)([⁺⁻])$/);
      if (sided) {
        point = sided[1];
        direction = sided[2] === "⁺" ? ', "+"' : ', "-"';
      }
      const body = this.term();
      return `limit(${body}, ${variable}, ${point}${direction})`;
    }
  }

  function latexToCalc(latex) {
    const parser = new Parser(tokenize(latex));
    const out = parser.list();
    parser.skipSpaces();
    if (parser.i < parser.tokens.length) {
      const tok = parser.peek();
      throw new LatexError(`unexpected ${tok.t === "cmd" ? "\\" + tok.v : tok.v}`);
    }
    return out;
  }

  root.latexToCalc = latexToCalc;
  root.LatexError = LatexError;
  if (typeof module !== "undefined") module.exports = { latexToCalc, LatexError };
})(typeof window !== "undefined" ? window : globalThis);
