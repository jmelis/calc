// The functions both layouts offer, by menu: the desktop palette shows a menu's keys in
// one row (app.js), the touch keypad six at a time as soft keys (keypad.js). One list,
// so the two can't drift apart.
//
// A key is {label, tex?, word?, kind?, tip?, alts?, only?} plus what it does: template
// and math (| is the cursor, or wraps the selection; in the math input's LaTeX #0 is the
// selection and #? an empty box; math null means text input only; method: on an empty
// line it applies to ans), type (characters to type, with math for the math input if
// typing them there isn't right), or action. label is LaTeX when tex is set; word is a
// plain-text label instead. alts are the touch keypad's long press. only: "touch" or
// "desktop" for a key one layout doesn't need (a keyboard has letters; the keypad has π
// and ^ in its fixed rows).

const typed = (label, type, extra = {}) => ({ label, type, ...extra });
const letter = (name, extra = {}) => typed(name, name, { tex: true, ...extra });
const greek = (name) => typed(`\\${name}`, name, { tex: true, math: `\\${name}` });
const fn = (label, template, math, tip, extra = {}) => ({ label, tex: true, template, math, tip, ...extra });
const word = (text, template, math, tip, extra = {}) => ({ word: text, template, math, tip, ...extra });

const MENUS = [
  {
    name: "xy",
    label: "x\\,y",
    tip: "Powers, roots, constants",
    keys: [
      letter("y", { only: "touch", tip: "A symbol", alts: ["a", "b", "c"].map((n) => letter(n)) }),
      letter("z", { only: "touch", tip: "A symbol", alts: ["w", "u", "v"].map((n) => letter(n)) }),
      letter("t", { only: "touch", tip: "A symbol", alts: ["n", "k", "m"].map((n) => letter(n)).concat(greek("theta")) }),
      fn("x^2", "^2", "^2", "Squares what's before the cursor (on an empty line, the last result)", {
        alts: [fn("x^3", "^3", "^3", "Cubes what's before the cursor")],
      }),
      fn("x^n", "^(|)", "^{#0}", "Raise to any power, like 2¹⁰ or x^(1/3)", { only: "desktop" }),
      fn("x^{-1}", "^-1", "^{-1}", "One over what's before the cursor (on an empty line, the last result)"),
      fn("\\sqrt{x}", "sqrt(|)", "\\sqrt{#0}", "√8 = 2√2, kept exact"),
      fn("\\pi", "pi", "\\pi", "Exact π; press f on a result for its decimal value", { only: "desktop" }),

      fn("e", "e", "e", "e ≈ 2.71828, the base of the natural log"),
      fn("i", "I", "i", "i² = −1, for complex numbers"),
      fn("\\infty", "oo", "\\infty", "For limits, sums and integrals that go on forever"),
      fn("\\frac{a}{b}", "(|)/()", "\\frac{#0}{#?}", "Results stay exact: 1/3 + 1/6 = 1/2"),
      fn("|x|", "abs(|)", "\\left|#0\\right|", "Distance from zero: |−3| = 3"),
      fn("\\sqrt[n]{x}", "root(|, 3)", "\\sqrt[#?]{#0}", "Root of any degree: the cube root of 27 is 3"),
    ],
  },
  {
    name: "fx",
    label: "f(x)",
    tip: "Trigonometry, logarithms, factorials",
    keys: [
      fn("\\sin", "sin(|)", "\\sin\\left(#0\\right)", "Angle in radians; add ° for degrees", {
        alts: [fn("\\sinh", "sinh(|)", "\\sinh\\left(#0\\right)", "Hyperbolic sine")],
      }),
      fn("\\cos", "cos(|)", "\\cos\\left(#0\\right)", "Angle in radians; add ° for degrees", {
        alts: [fn("\\cosh", "cosh(|)", "\\cosh\\left(#0\\right)", "Hyperbolic cosine")],
      }),
      fn("\\tan", "tan(|)", "\\tan\\left(#0\\right)", "Angle in radians; add ° for degrees", {
        alts: [fn("\\tanh", "tanh(|)", "\\tanh\\left(#0\\right)", "Hyperbolic tangent")],
      }),
      fn("x^\\circ", "°", "\\degree", "Angles are radians unless marked: sin(30°) = 1/2"), // with sin cos tan, on the same page
      fn("\\ln", "log(|)", "\\ln\\left(#0\\right)", "Logarithm base e"),
      fn("\\log_b", "log(|, 10)", "\\log_{#?}\\left(#0\\right)", "Any base: log₂ 8 = 3", {
        alts: [fn("\\log_2", "log(|, 2)", "\\log_{2}\\left(#0\\right)", "Base 2: log₂ 8 = 3")],
      }),

      fn("\\sin^{-1}", "asin(|)", "\\arcsin\\left(#0\\right)", "The angle whose sine this is, in radians: asin(1) = π/2"),
      fn("\\cos^{-1}", "acos(|)", "\\arccos\\left(#0\\right)", "The angle whose cosine this is, in radians"),
      fn("\\tan^{-1}", "atan(|)", "\\arctan\\left(#0\\right)", "The angle whose tangent this is, in radians: atan(1) = π/4"),
      fn("e^x", "exp(|)", "e^{#0}", "e raised to a power"),
      fn("n!", "!", "!", "5! = 5·4·3·2·1 = 120"),
      fn("\\tbinom{n}{k}", "binomial(|, )", "\\binom{#0}{#?}", "Ways to choose k of n items: 5 choose 2 = 10"),
    ],
  },
  {
    name: "calc",
    label: "\\textstyle\\int",
    tip: "Calculus and algebra",
    keys: [
      fn("\\frac{d}{dx}", "diff(|, x)", "\\frac{d}{dx}\\left(#0\\right)", "Rate of change with respect to x"),
      fn("\\int", "integrate(|, x)", "\\int #0\\,dx", "Antiderivative with respect to x"),
      fn("\\int_a^b", "integrate(|, (x, 0, 1))", "\\int_{#?}^{#?} #0\\,dx", "Area under the curve from a to b"),
      fn("\\lim", "limit(|, x, 0)", "\\lim_{x\\to #?} #0", "What the expression approaches as x → a"),
      fn("\\sum", "summation(|, (k, 1, n))", "\\sum_{k=#?}^{#?} #0", "Add up terms for k from a to b; b can be ∞"),
      word("solve", "solve(|, x)", "\\operatorname{solve}\\left(#0, x\\right)", "Values of x that make it zero, or that satisfy an equation"),

      word("simplify", "simplify(|)", "\\operatorname{simplify}\\left(#0\\right)", "Rewrite in the simplest form SymPy can find"),
      word("factor", "factor(|)", "\\operatorname{factor}\\left(#0\\right)", "As a product: x² − 1 → (x − 1)(x + 1)"),
      word("expand", "expand(|)", "\\operatorname{expand}\\left(#0\\right)", "Multiply out: (x + 1)² → x² + 2x + 1"),
      word("plot", "plot(|, (x, -5, 5))", "\\operatorname{plot}\\left(#0, \\left(x, -5, 5\\right)\\right)", "Graph it for x from −5 to 5 (edit the range after inserting)"),
      word("iplot", "iplot(|)", "\\operatorname{iplot}\\left(#0\\right)", "A graph you can drag and zoom: iplot(sin(x)/x)"),
      word("series", "series(|, x, 0, 6)", "\\operatorname{series}\\left(#0, x, 0, 6\\right)", "Taylor series around 0, up to x⁶ (edit after inserting)"),
    ],
  },
  {
    name: "mat",
    label: "[\\,]",
    tip: "Matrices and vectors",
    keys: [
      word("M[ ]", "M[|]", "\\begin{bmatrix}#0 & #?\\\\ #? & #?\\end{bmatrix}", "A matrix: M[1, 2] is one row, M[[1, 2], [3, 4]] two"),
      word("V[ ]", "V[|]", "\\begin{bmatrix}#0\\\\ #?\\end{bmatrix}", "A column vector: V[1, 2]"),
      fn("[\\,]", "[|]", "\\left[#0\\right]", "The rows in M[[1, 2], [3, 4]]; parts of a matrix: A[0, 1], A[1, :]"),
      fn("\\det", "det(|)", "\\det\\left(#0\\right)", "Determinant"),
      fn("A^{-1}", "^-1", "^{-1}", "Inverse of what's before the cursor (on an empty line, the last result)"),
      fn("A^{T}", ".T", null, "Transpose of what's before the cursor", { method: true }),

      fn("u\\cdot v", ".dot(|)", null, "Dot product: v.dot(w)", { method: true }),
      fn("u\\times v", ".cross(|)", null, "Cross product: v.cross(w)", { method: true }),
      typed(":", ":", { only: "touch", tip: "A whole row or column: A[1, :], A[:, 0]" }),
      word("eigen", ".eigenvals()", null, "Eigenvalues, each with how many times it appears", { method: true }),
      word("rref", ".rref()", null, "Reduced row echelon form, and the pivot columns", { method: true }),
      word("eye", "eye(|)", "\\operatorname{eye}\\left(#0\\right)", "The identity matrix: eye(3)"),
    ],
  },
];

// A menu's keys for one layout ("touch" or "desktop")
function menuKeys(name, layout) {
  return MENUS.find((m) => m.name === name).keys.filter((k) => !k.only || k.only === layout);
}

// The menu last chosen, in either layout
function savedMenu() {
  try {
    const name = localStorage.getItem("calc.menu");
    if (MENUS.some((m) => m.name === name)) return name;
  } catch {}
  return MENUS[0].name;
}

function saveMenu(name) {
  try {
    localStorage.setItem("calc.menu", name);
  } catch {}
}
