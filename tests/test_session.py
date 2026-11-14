from sympy import beta

from calc.session import Session, configure_matplotlib, warm_up_plotting


def run(session, src, entry_id=1):
    payload = session.run(src, entry_id)
    assert "error" not in payload, payload["error"]
    return payload


def test_exact_float_and_degrees_views():
    result = run(Session(), "atan(1)")["result"]
    assert result["text"] == "pi/4"
    assert result["float"]["text"] == "0.785398163397448"
    assert result["degrees"]["text"] == "45°"


def test_no_float_view_when_it_adds_nothing():
    result = run(Session(), "x^2 + 1")["result"]
    assert "float" not in result and "degrees" not in result


def test_assign_define_and_ans():
    s = Session()
    assert run(s, "a = 22/35")["result"]["label"] == "a"
    run(s, "f(x) = x^2 + 1")
    assert run(s, "f(a)")["result"]["text"] == "1709/1225"
    assert run(s, "ans * 1225")["result"]["text"] == "1709"


def test_references_and_text_round_trip():
    s = Session()
    run(s, "Matrix([[1, 2], [3, 4]]).inv()", 1)
    text = s.run("$1", 2)["result"]["text"]
    assert "\n" not in text  # single line, so it can be pasted back
    assert run(s, text, 3)["result"]["text"] == text


def test_python_fallback_and_output():
    payload = run(Session(), 'for i in range(2): print(i)')
    assert payload["outputs"] == [{"kind": "text", "text": "0\n1\n"}]
    assert "result" not in payload


def test_errors_are_reported():
    payload = Session().run("x +", 1)
    assert payload["error"].startswith("SyntaxError")


def test_names_print_upright_and_read_back():
    s = Session()
    result = run(s, "velocity^2 + x2")["result"]
    assert result["latex"] == r"\mathrm{velocity}^{2} + \mathrm{x2}"


def test_class_results():
    assert run(Session(), "type(100)")["result"]["plain"] == "<class 'sympy.core.numbers.Integer'>"


def test_statistics():
    s = Session()
    assert run(s, "mean([2, 4, 4, 5])")["result"]["text"] == "15/4"
    assert run(s, "stdev([2, 4, 4, 5])")["result"]["text"] == "sqrt(57)/6"
    assert run(s, "median(3, 1, 4, 1)")["result"]["text"] == "2"


def test_state_restores_variables():
    s = Session()
    run(s, "a = 22/35", 1)
    run(s, "f(x) = x^2", 2)
    restored = Session(s.state())
    assert run(restored, "a + f(2) + $1")["result"]["text"] == "184/35"
    assert [v["name"] for v in restored.variables()] == ["ans", "a", "f"]


def test_forget_restores_shadowed_names():
    s = Session()
    run(s, "beta = 2")
    s.forget("beta")
    assert s.ns["beta"] is beta
    assert "beta" not in [v["name"] for v in s.variables()]


def test_unreadable_state_is_ignored():
    assert run(Session(b"not a pickle"), "1 + 1")["result"]["text"] == "2"


def test_plot_is_an_image_without_axis_labels():
    configure_matplotlib()
    payload = run(Session(), "plot(sin(x), (x, -5, 5))")
    assert "result" not in payload  # not the plot object's repr
    [image] = payload["outputs"]
    assert image["kind"] == "image" and image["width"] == 700 and image["png"]


def test_warming_up_plotting_leaves_no_figure_behind():
    configure_matplotlib()
    warm_up_plotting()
    session = Session()
    assert run(session, "1 + 1")["outputs"] == []
    assert len(run(session, "plot(x^2)")["outputs"]) == 1


def test_python_statements_run_as_python():
    s = Session()
    run(s, "def double(x): y = 2*x; return y")
    assert run(s, "double(21)")["result"]["text"] == "42"
    assert run(s, "for i in range(2): print(i)")["outputs"][0]["text"] == "0\n1\n"


def test_forgetting_can_be_undone():
    s = Session()
    run(s, "a = [1, 2]")
    run(s, "f(x) = x^2")
    saved = {name: s.pickled(name) for name in ("a", "f")}
    for name in saved:
        s.forget(name)
    assert s.run("f(3)", 2)["result"]["text"] != "9"
    for name, data in saved.items():
        s.unforget(name, data)
    assert run(s, "f(3) + a[0]")["result"]["text"] == "10"
    assert s.pickled("undefined") is None
