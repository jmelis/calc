"""M[…] and V[…] (matrices.py), through the session."""
import pytest

from calc.session import Session


def text(session, src, entry_id=1):
    payload = session.run(src, entry_id)
    assert "error" not in payload, payload["error"]
    return payload["result"]["text"]


@pytest.mark.parametrize(
    "src, expected",
    [
        ("M[1, 2, 3]", "M[1, 2, 3]"),  # a row
        ("M[[1, 2], [3, 4]]", "M[[1, 2], [3, 4]]"),
        ("V[1, 2, 3]", "V[1, 2, 3]"),  # a column
        ("V[1, 2, 3] == M[1, 2, 3].T", "True"),
        ("M[[1, 2], [3, 4]]^-1", "M[[-2, 1], [3/2, -1/2]]"),
        ("M[[1, 2], [3, 4]]*V[1, 1]", "V[3, 7]"),
        ("2V[1, 2] + V[3, 4]", "V[5, 8]"),
        ("det(M[[1, 2], [3, 4]])", "-2"),
        ("V[1, 0, 0].cross(V[0, 1, 0])", "V[0, 0, 1]"),
        ("V[1, 2, 3].dot(V[4, 5, 6])", "32"),
        ("M[x, y]", "M[x, y]"),
        ("eye(2)", "M[[1, 0], [0, 1]]"),
        # lists are Python lists
        ("2*[1, 2]", "[1, 2, 1, 2]"),
        ("[i^2 for i in range(5)]", "[0, 1, 4, 9, 16]"),
        ("max([1, 5, 3])", "5"),
    ],
)
def test_matrices_and_lists(src, expected):
    assert text(Session(), src) == expected


def test_results_round_trip_as_text():
    s = Session()
    for i, src in enumerate(["M[[1, 2], [3, 4]].inv()", "V[1, 2]", "M[1, 2]", "zeros(0, 2)"], 1):
        result = text(s, src, i)
        assert text(s, result, 10 + i) == result


def test_mixing_rows_and_numbers_is_explained():
    assert "list of rows" in Session().run("M[[1, 2], 3]", 1)["error"]


def test_changing_part_of_a_matrix():
    s = Session()
    text(s, "A = M[[1, 2], [3, 4]]", 1)
    assert text(s, "A[0, 1] = 5", 2) == "M[[1, 5], [3, 4]]"
    assert s.run("A[1, :] = M[7, 8]", 3)["result"]["label"] == "A"
    assert text(s, "A[:, 0] = V[0, 0]", 4) == "M[[0, 5], [0, 8]]"
    assert text(Session(s.state()), "A[1, 1]", 5) == "8"  # kept across a restart
    assert text(s, "$1", 6) == "M[[1, 2], [3, 4]]"  # earlier results keep their values
    assert text(s, "$2", 7) == "M[[1, 5], [3, 4]]"


def test_m_and_v_can_be_redefined_and_come_back():
    s = Session()
    text(s, "M = 3")
    assert text(s, "M + 1") == "4"
    s.forget("M")
    assert text(s, "M[1, 2]") == "M[1, 2]"


def test_preview():
    s = Session()
    assert s.preview("M[[1, 2], [3, 4]]") == r"\begin{bmatrix}1 & 2 \\ 3 & 4\end{bmatrix}"
    assert s.preview("V[1, 2]") == r"\begin{bmatrix}1 \\ 2\end{bmatrix}"
    text(s, "M = 3")
    assert "bmatrix" not in s.preview("M[1]")  # a variable named M is just M
