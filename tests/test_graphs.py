"""iplot (graphs.py): the samples the page draws, and resampling for zoom and pan."""
import pytest

from calc.graphs import warm_up_iplot
from calc.session import Session


def graph(session, src):
    payload = session.run(src, 1)
    assert "error" not in payload, payload["error"]
    assert "result" not in payload  # the graph is the output
    [out] = [o for o in payload["outputs"] if o["kind"] == "graph"]
    return out


def test_one_function_over_the_default_range():
    out = graph(Session(), "iplot(sin(x))")
    assert out["range"] == [-10, 10] and out["var_name"] == "x" and out["texts"] == ["sin(x)"]
    assert out["data"]["x"] == [-10, 10, 800] and len(out["data"]["ys"][0]) == 800
    assert out["data"]["y"] == pytest.approx([-1.1, 1.1], abs=0.01)


def test_several_functions_over_a_range():
    out = graph(Session(), "iplot(sin x, cos x, (x, 0, 2pi))")
    assert len(out["data"]["ys"]) == 2 and out["range"][1] == pytest.approx(6.2832, abs=1e-4)


def test_gaps_where_it_isnt_real_or_jumps_at_a_pole():
    sqrt_ys = graph(Session(), "iplot(sqrt(x))")["data"]["ys"][0]
    assert sqrt_ys[0] is None and sqrt_ys[-1] == pytest.approx(3.1623, abs=1e-4)
    tan = graph(Session(), "iplot(tan(x), (x, 0, 3))")["data"]
    assert None in tan["ys"][0]  # the pole at pi/2 isn't joined across
    assert -20 < tan["y"][0] and tan["y"][1] < 20  # nor does it flatten the rest


def test_functions_numpy_lacks_and_constants():
    assert None not in graph(Session(), "iplot(gamma(x), (x, 1, 4))")["data"]["ys"][0]
    assert set(graph(Session(), "iplot(3)")["data"]["ys"][0]) == {3.0}


def test_resampling_a_zoomed_range():
    s = Session()
    out = graph(s, "iplot(x^2)")
    data = s.sample(out["exprs"], out["var"], 1, 2)
    assert data["x"] == [1, 2, 800] and data["ys"][0][0] == 1 and data["ys"][0][-1] == 4


@pytest.mark.parametrize(
    "src, message",
    [
        ("iplot()", "needs something to draw"),
        ("iplot(x y)", "over which of x, y"),
        ("iplot(x^2 = 4)", "not equations"),
        ("iplot(a x, (x, 0, 1))", "a has no value"),
        ("iplot(x, (x, 1, 0))", "low to high"),
    ],
)
def test_errors_say_what_to_do(src, message):
    assert message in Session().run(src, 1)["error"]


def test_plot_is_still_matplotlib():
    assert Session().run("plot(sin(x))", 1)["outputs"][0]["kind"] == "image"


def test_warm_up():
    warm_up_iplot()
