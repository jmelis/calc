import pytest

from calc.preview import preview


@pytest.mark.parametrize(
    "src, expected",
    [
        ("integrate(sin(x)^2, x)", r"\int {\sin\left(x\right)}^{2}\, dx"),
        ("integrate(x^2, (x, 0, 1))", r"\int_{0}^{1} {x}^{2}\, dx"),
        ("diff(sin x, x, 2)", r"\frac{d^{2}}{dx^{2}} \sin\left(x\right)"),
        ("limit(sin(x)/x, x, 0)", r"\lim_{x \to 0} \frac{\sin\left(x\right)}{x}"),
        ("summation(1/k^2, (k, 1, oo))", r"\sum_{k=1}^{\infty} \frac{1}{{k}^{2}}"),
        ("log(8, 2)", r"\log_{2}\left(8\right)"),
        ("x - (1 + 2)", r"x - \left(1 + 2\right)"),
        ("2x + 3y", "2 x + 3 y"),
        ("x*-3", r"x \left(-3\right)"),
        ("sin(pi) (-0.5 x)", r"\sin\left(\pi\right) \left(-0.5 x\right)"),  # not sin π - 0.5 x
        ("x + (-1.5 - y)", r"x + \left(-1.5 - y\right)"),
        ("x - (-2 y)", r"x - \left(-2 y\right)"),
        ("-(-x)", r"-\left(-x\right)"),
        ("3*0.45^2", r"3 \cdot {0.45}^{2}"),  # not 30.45^2
        ("3*(5!)^2", r"3 \cdot {5!}^{2}"),
        ("0.45*(1/2)", r"0.45 \cdot \frac{1}{2}"),
        ("30°*(1/2)", r"30^{\circ} \cdot \frac{1}{2}"),
        ("x*(1/2)", r"x \frac{1}{2}"),
        ("64/(3*2^3)", r"\frac{64}{3 \cdot {2}^{3}}"),
        ("x^(2*3^2)", r"{x}^{2 \cdot {3}^{2}}"),
        ("2*3^2*4", r"2 \cdot {3}^{2} \cdot 4"),
        ("$3 * 2 + ans", r"\boxed{3} \cdot 2 + \mathrm{ans}"),
        ("a = 3/7", r"a = \frac{3}{7}"),  # "=", not ":=", so copying it back is valid input
        ("f(x, y) = x^2 + y", r"f\left(x, y\right) = {x}^{2} + y"),
        ("sin(30°)", r"\sin\left(30^{\circ}\right)"),
        ("binomial(5, 2)", r"\binom{5}{2}"),
        ("Matrix([[1,2],[3,4]])", r"\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}"),
        ("theta_1 + alpha", r"\theta_{1} + \alpha"),
        ("lamda + x_1", r"\lambda + x_{1}"),  # SymPy's spelling of λ (lambda is Python's)
        ("3/7+sqrt2", r"\frac{3}{7} + \mathrm{sqrt2}"),  # how it will evaluate: sqrt2 is one name
        ("x y + xy", r"x y + \mathrm{xy}"),
    ],
)
def test_preview(src, expected):
    assert preview(src) == expected


def test_known_names_stay_whole():
    assert preview("ab + 1", variables=["ab"]) == r"\mathrm{ab} + 1"
    assert preview("myfunc(sin(x))", functions=["myfunc"]) == r"\operatorname{myfunc}\left(\sin\left(x\right)\right)"


def test_python_statements_have_no_preview():
    with pytest.raises(SyntaxError):
        preview("for i in range(3): print(i)")
