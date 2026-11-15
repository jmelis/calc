"""
The app icons: the favicon's 2π on orange, as the PNGs a home-screen app needs.

iOS won't take an SVG for apple-touch-icon and Android wants a maskable one, so these
are flat squares with the glyph well inside the mask's safe circle. Run it when the
icon changes; the PNGs are committed (the site has no build step):

    uv run python tools/make_icons.py
"""
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

matplotlib.rcParams["mathtext.fontset"] = "dejavuserif"  # a π that reads as one

ROOT = __file__.rsplit("/", 2)[0]
ORANGE = "#c2410c"
SIZES = (180, 192, 512)  # apple-touch-icon, and the manifest's two


def draw(size):
    figure = plt.figure(figsize=(size / 100, size / 100), dpi=100, facecolor=ORANGE)
    figure.text(
        0.5, 0.5, r"$2\pi$", ha="center", va="center", color="white", fontsize=size * 0.42,
    )
    path = f"{ROOT}/icon-{size}.png"
    figure.savefig(path, dpi=100, facecolor=ORANGE)
    plt.close(figure)
    return path


if __name__ == "__main__":
    for size in SIZES:
        print(draw(size))
