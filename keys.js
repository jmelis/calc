// The functions both layouts offer, by menu: the desktop palette shows a menu's keys in
// a row (app.js), the touch keypad five at a time as soft keys (keypad.js). One list, so
// the two can't drift apart.
//
// A key is {label, tex?, word?, kind?, tip?, only?} plus what it does: template
// and math (| is the cursor, or wraps the selection; in the math input's LaTeX #0 is the
// selection and #? an empty box; math null means text input only; method: on an empty
// line it applies to ans), type (characters to type, with math for the math input if
// typing them there isn't right), or action. label is LaTeX when tex is set; word is a
// plain-text label instead. only: "touch" or "desktop" for a key or a menu one layout
// doesn't need.

const typed = (label, type, extra = {}) => ({ label, type, ...extra });
const letter = (name, extra = {}) => typed(name, name, { tex: true, ...extra });
const greek = (name) => typed(`\\${name}`, name, { tex: true, math: `\\${name}` });
const fn = (label, template, math, tip, extra = {}) => ({ label, tex: true, template, math, tip, ...extra });
const word = (text, template, math, tip, extra = {}) => ({ word: text, template, math, tip, ...extra });

// Menus as on a TI-84 (its MATH, and our CALC, MATRIX, STAT), whose keys the touch
// keypad shows five at a time as soft keys. f(x) is the desktop's only: on the keypad
// those functions have keys of their own (sin, x², √ on 2nd…).
const MENUS = [
  {
    name: "fx",
    label: "f(x)",
    tip: "Powers, roots, constants, trigonometry, logarithms",
    only: "desktop",
    keys: [
      fn("x^2", "^2", "^2", "Squares what's before the cursor (on an empty line, the last result)"),
      fn("x^n", "^(|)", "^{#0}", "Raise to any power, like 2¹⁰ or x^(1/3)"),
      fn("x^{-1}", "^-1", "^{-1}", "One over what's before the cursor (on an empty line, the last result)"),
      fn("\\sqrt{x}", "sqrt(|)", "\\sqrt{#0}", "√8 = 2√2, kept exact"),
      fn("\\sqrt[n]{x}", "root(|, 3)", "\\sqrt[#?]{#0}", "Root of any degree: the cube root of 27 is 3"),
      fn("\\pi", "pi", "\\pi", "Exact π; press f on a result for its decimal value"),
      fn("e", "e", "e", "e ≈ 2.71828, the base of the natural log"),
      fn("i", "I", "i", "i² = −1, for complex numbers"),
      fn("\\sin", "sin(|)", "\\sin\\left(#0\\right)", "Angle in radians; add ° for degrees"),
      fn("\\cos", "cos(|)", "\\cos\\left(#0\\right)", "Angle in radians; add ° for degrees"),
      fn("\\tan", "tan(|)", "\\tan\\left(#0\\right)", "Angle in radians; add ° for degrees"),
      fn("\\sin^{-1}", "asin(|)", "\\arcsin\\left(#0\\right)", "The angle whose sine this is, in radians: asin(1) = π/2"),
      fn("\\cos^{-1}", "acos(|)", "\\arccos\\left(#0\\right)", "The angle whose cosine this is, in radians"),
      fn("\\tan^{-1}", "atan(|)", "\\arctan\\left(#0\\right)", "The angle whose tangent this is, in radians: atan(1) = π/4"),
      fn("\\ln", "log(|)", "\\ln\\left(#0\\right)", "Logarithm base e"),
      fn("\\log", "log(|, 10)", "\\log_{10}\\left(#0\\right)", "Logarithm base 10 (log(x, b) for any base)"),
      fn("e^x", "exp(|)", "e^{#0}", "e raised to a power"),
    ],
  },
  {
    name: "math",
    label: "math",
    tip: "Fractions, absolute value, degrees, factorials, rounding",
    keys: [
      fn("\\frac{a}{b}", "(|)/()", "\\frac{#0}{#?}", "Results stay exact: 1/3 + 1/6 = 1/2"),
      fn("|x|", "abs(|)", "\\left|#0\\right|", "Distance from zero: |−3| = 3"),
      fn("x^\\circ", "°", "\\degree", "Angles are radians unless marked: sin(30°) = 1/2"),
      fn("n!", "!", "!", "5! = 5·4·3·2·1 = 120"),
      fn("\\tbinom{n}{k}", "binomial(|, )", "\\binom{#0}{#?}", "Ways to choose k of n items: 5 choose 2 = 10"),

      fn("\\infty", "oo", "\\infty", "For limits, sums and integrals that go on forever"),
      word("mod", "Mod(|, )", "\\operatorname{Mod}\\left(#0, #?\\right)", "Remainder: Mod(7, 3) = 1 (7 % 3 too)"),
      word("floor", "floor(|)", "\\operatorname{floor}\\left(#0\\right)", "Round down: floor(2.7) = 2"),
      word("ceil", "ceiling(|)", "\\operatorname{ceiling}\\left(#0\\right)", "Round up: ceiling(2.1) = 3"),
      word("gcd", "gcd(|, )", "\\gcd\\left(#0, #?\\right)", "Greatest common divisor: gcd(12, 18) = 6"),

      word("lcm", "lcm(|, )", "\\operatorname{lcm}\\left(#0, #?\\right)", "Least common multiple: lcm(4, 6) = 12"),
      fn("\\sinh", "sinh(|)", "\\sinh\\left(#0\\right)", "Hyperbolic sine"),
      fn("\\cosh", "cosh(|)", "\\cosh\\left(#0\\right)", "Hyperbolic cosine"),
      fn("\\tanh", "tanh(|)", "\\tanh\\left(#0\\right)", "Hyperbolic tangent"),
      word("isprime", "isprime(|)", "\\operatorname{isprime}\\left(#0\\right)", "True if prime: isprime(97)"),
    ],
  },
  {
    name: "calc",
    label: "calc",
    tip: "Calculus, algebra, plots",
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
      word("series", "series(|, x, 0, 6)", "\\operatorname{series}\\left(#0, x, 0, 6\\right)", "Taylor series around 0, up to x⁶ (edit after inserting)"),

      word("plot", "plot(|, (x, -5, 5))", "\\operatorname{plot}\\left(#0, \\left(x, -5, 5\\right)\\right)", "Graph it for x from −5 to 5 (edit the range after inserting)"),
      word("iplot", "iplot(|)", "\\operatorname{iplot}\\left(#0\\right)", "A graph you can drag and zoom: iplot(sin(x)/x)"),
      word("apart", "apart(|)", "\\operatorname{apart}\\left(#0\\right)", "Partial fractions: 1/(x² − 1) → 1/(2(x − 1)) − 1/(2(x + 1))"),
      word("together", "together(|)", "\\operatorname{together}\\left(#0\\right)", "One fraction: 1/x + 1/y → (x + y)/(xy)"),
      fn("\\prod", "product(|, (k, 1, n))", "\\prod_{k=#?}^{#?} #0", "Multiply terms for k from a to b"),
    ],
  },
  {
    name: "mat",
    label: "matrix",
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
      word("eigen", ".eigenvals()", null, "Eigenvalues, each with how many times it appears", { method: true }),
      word("rref", ".rref()", null, "Reduced row echelon form, and the pivot columns", { method: true }),

      word("eye", "eye(|)", "\\operatorname{eye}\\left(#0\\right)", "The identity matrix: eye(3)"),
      word("rank", ".rank()", null, "How many rows are independent", { method: true }),
      typed(":", ":", { only: "touch", tip: "A whole row or column: A[1, :], A[:, 0]" }),
    ],
  },
  {
    name: "stat",
    label: "stat",
    tip: "Statistics of a list or of several numbers",
    keys: [
      word("mean", "mean(|)", "\\operatorname{mean}\\left(#0\\right)", "Average: mean(1, 2, 6) = 3, or of a list"),
      word("median", "median(|)", "\\operatorname{median}\\left(#0\\right)", "The middle value: median(1, 5, 2) = 2"),
      word("stdev", "stdev(|)", "\\operatorname{stdev}\\left(#0\\right)", "Sample standard deviation"),
      word("variance", "variance(|)", "\\operatorname{variance}\\left(#0\\right)", "Sample variance"),
      word("max", "max(|)", "\\max\\left(#0\\right)", "The largest: max(1, 5, 3), or of a list"),

      word("min", "min(|)", "\\min\\left(#0\\right)", "The smallest: min(1, 5, 3), or of a list"),
      word("pstdev", "pstdev(|)", "\\operatorname{pstdev}\\left(#0\\right)", "Population standard deviation"),
      word("pvariance", "pvariance(|)", "\\operatorname{pvariance}\\left(#0\\right)", "Population variance"),
      word("sum", "sum(|)", "\\operatorname{sum}\\left(#0\\right)", "Add up a list: sum([1, 2, 3]) = 6"),
      fn("[\\,]", "[|]", "\\left[#0\\right]", "A list: [1, 2, 3]"),
    ],
  },
];

// The menus one layout ("touch" or "desktop") shows
function layoutMenus(layout) {
  return MENUS.filter((m) => !m.only || m.only === layout);
}

// A menu's keys for one layout
function menuKeys(name, layout) {
  return MENUS.find((m) => m.name === name).keys.filter((k) => !k.only || k.only === layout);
}

// The menu last chosen in a layout (they have different ones)
function savedMenu(layout) {
  try {
    const name = localStorage.getItem(`calc.menu.${layout}`);
    if (layoutMenus(layout).some((m) => m.name === name)) return name;
  } catch {}
  return layoutMenus(layout)[0].name;
}

function saveMenu(layout, name) {
  try {
    localStorage.setItem(`calc.menu.${layout}`, name);
  } catch {}
}
