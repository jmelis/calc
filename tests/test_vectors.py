"""Lists that are also vectors and matrices (vectors.py), through the session."""
import pickle

import pytest

from calc.session import Session

M = "[[1, 2], [3, 4]]"


def text(session, src):
    payload = session.run(src, 1)
    assert "error" not in payload, payload["error"]
    return payload["result"]["text"]


@pytest.mark.parametrize(
    "src, expected",
    [
        ("[1, 2, 3]", "[1, 2, 3]"),
        ("2[1, 2, 3]", "[2, 4, 6]"),
        ("[1, 2]/2", "[1/2, 1]"),
        ("[1, 2] + [3, 4]", "[4, 6]"),
        ("[x, y] - [1, 1]", "[x - 1, y - 1]"),
        ("-[1, 2]", "[-1, -2]"),
        (f"{M}^-1", "[[-2, 1], [3/2, -1/2]]"),
        (f"{M}*{M}", "[[7, 10], [15, 22]]"),
        (f"{M}*[1, 1]", "[3, 7]"),
        (f"[1, 1]*{M}", "[4, 6]"),  # a vector before a matrix is a row
        (f"eye(2) + {M}", "[[2, 2], [3, 5]]"),
        (f"det({M})", "-2"),
        (f"{M}.det()", "-2"),
        (f"{M}.T", "[[1, 3], [2, 4]]"),
        (f"{M}[0, 1]", "2"),
        (f"{M}[1]", "[3, 4]"),
        ("[1, 2, 3].dot([4, 5, 6])", "32"),
        ("[1, 0, 0].cross([0, 1, 0])", "[0, 0, 1]"),
        ("[3, 4].norm()", "5"),
        ("diff([x^2, x^3], x)", "[2*x, 3*x**2]"),
        ("simplify([sin(x)^2 + cos(x)^2, 1])", "[1, 1]"),
        ("Matrix([1, 2])", "[1, 2]"),  # one-column results are vectors
        # still lists
        ("len([1, 2, 3])", "3"),
        ("sum([1, 2, 3])", "6"),
        ("max([1, 5, 3])", "5"),
        ("[1, 2, 3][0]", "1"),
        ("solve([x + y = 1, x - y = 0], [x, y])", "{x: 1/2, y: 1/2}"),
        ("[i^2 for i in range(5)]", "[0, 1, 4, 9, 16]"),
        ("[[i + j for j in range(2)] for i in range(2)]^2", "[[1, 2], [2, 5]]"),
        ("sum(k^2 for k in range(4))", "14"),
        ("[0]*3", "[0]"),  # math, not repetition: documented
    ],
)
def test_vector_math(src, expected):
    assert text(Session(), src) == expected


def test_list_results_are_vectors():
    s = Session()
    text(s, "solve(x^2 = 4, x)")
    assert text(s, "2ans") == "[-4, 4]"
    text(s, "v = [1, 2]")
    assert text(s, "v + v") == "[2, 4]"


def test_vectors_survive_a_restart():
    s = Session()
    text(s, "v = [1, 2]")
    assert text(Session(s.state()), "2v") == "[2, 4]"


def test_two_vectors_dont_multiply():
    assert "v.dot(w)" in Session().run("[1, 2]*[3, 4]", 1)["error"]


def test_lists_of_other_things_are_python_lists():
    assert Session().run('["a"] * 2', 1)["result"]["plain"] == "['a', 'a']"


def test_vectors_show_as_lists_and_matrices_as_matrices():
    s = Session()
    assert s.run("[1, 2]", 1)["result"]["items"]["items"] == ["1", "2"]
    for src in [M, f"{M}^2", "[[1, 2]]"]:
        result = s.run(src, 2)["result"]
        assert r"\begin{matrix}" in result["latex"] and "items" not in result
    assert result["text"] == "[[1, 2]]"  # inserted back as typed
    assert "matrix" not in s.run("[[1, 2], [3]]", 3)["result"]["latex"]  # ragged: a list of lists
    assert s.preview(M) == r"\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}"


def test_vector_pickles():
    from calc.vectors import vector

    v = vector([[1, 2], [3, 4]])
    assert pickle.loads(pickle.dumps(v)) == v


def test_changing_part_of_a_matrix():
    s = Session()
    text(s, f"M = {M}")
    assert text(s, "M[0, 1] = 5") == "[[1, 5], [3, 4]]"
    assert s.run("M[1] = [7, 8]", 3)["result"]["label"] == "M"
    assert text(s, "M") == "[[1, 5], [7, 8]]"
    text(s, "v = [1, 2]")
    assert text(s, "v[0] = x") == "[x, 2]"
    assert text(Session(s.state()), "M[1, 1]") == "8"  # kept across a restart


def test_earlier_results_dont_change_with_the_variable():
    s = Session()
    s.run(f"M = {M}", 1)
    s.run("M[0, 0] = 9", 2)
    assert s.run("$1", 3)["result"]["text"] == M.replace(" ", "").replace(",", ", ")


def test_setting_a_column_is_explained():
    s = Session()
    text(s, f"M = {M}")
    assert "M[i] = [" in s.run("M[:, 0] = [1, 1]", 2)["error"]
