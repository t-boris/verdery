#!/usr/bin/env python3
"""Draws the Verdery app icon and writes it into the asset catalogue.

The icon is committed as a PNG because Xcode needs a real bitmap, but a
hand-placed binary nobody can regenerate is a dead end the first time the brand
moves. This script is the source: it derives the mark from the same design
tokens the web client uses (apps/web/shared/ui/tokens.css — `--color-accent`
#2f6b3f, `--color-accent-active` #204d2c, `--color-canvas` #f2f1e8), so the two
clients cannot drift apart silently.

The mark is a leaf whose midrib is a dotted survey line: the product is a
*living map* of a real garden, so the icon says both halves rather than
defaulting to a generic sprout.

Usage (from apps/ios):

    python3 Tools/generate-app-icon.py

Requires Pillow. Only ever run by hand when the artwork changes; the build
consumes the committed PNG and never invokes this.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

# Rendered large and downsampled — Pillow has no antialiased polygon fill, so
# supersampling is what keeps the leaf's edges clean at 1024.
FINAL_SIZE = 1024
SUPERSAMPLE = 4
CANVAS = FINAL_SIZE * SUPERSAMPLE

ACCENT = (47, 107, 63)  # --color-accent  #2f6b3f
ACCENT_DEEP = (32, 77, 44)  # --color-accent-active #204d2c
PAPER = (242, 241, 232)  # --color-canvas  #f2f1e8

ICON_SET = Path(__file__).resolve().parent.parent / "Resources" / "Assets.xcassets" / "AppIcon.appiconset"

# Every slot spelled out, rather than the single 1024 "universal" image Xcode 26
# offers. That newer form makes actool resolve the icon through the Icon
# Composer pipeline, which refuses to run unless an iOS *simulator runtime*
# matching the active iphonesimulator SDK is installed — an absurd dependency
# for a device archive, and one that broke the build on the machine this was
# written on. The classic per-idiom set has no such requirement and is
# understood by every Xcode that can build this project.
#
# (idiom, point size, scale)
SLOTS = [
    ("iphone", 20, 2), ("iphone", 20, 3),
    ("iphone", 29, 2), ("iphone", 29, 3),
    ("iphone", 40, 2), ("iphone", 40, 3),
    ("iphone", 60, 2), ("iphone", 60, 3),
    ("ipad", 20, 1), ("ipad", 20, 2),
    ("ipad", 29, 1), ("ipad", 29, 2),
    ("ipad", 40, 1), ("ipad", 40, 2),
    ("ipad", 76, 2),
    ("ipad", 83.5, 2),
    ("ios-marketing", 1024, 1),
]


def slot_filename(points: float, scale: int) -> str:
    label = f"{points:g}"
    return f"AppIcon-{label}x{label}@{scale}x.png"


def write_icon_set(master: Image.Image) -> None:
    """Writes every slot's PNG plus the Contents.json that assigns them."""
    ICON_SET.mkdir(parents=True, exist_ok=True)
    for stale in ICON_SET.glob("*.png"):
        stale.unlink()

    images = []
    for idiom, points, scale in SLOTS:
        pixels = round(points * scale)
        filename = slot_filename(points, scale)
        # Each slot is resampled from the same supersampled master, so no slot
        # is ever an upscale of a smaller one.
        master.resize((pixels, pixels), Image.LANCZOS).save(ICON_SET / filename, "PNG")
        images.append(
            {
                "filename": filename,
                "idiom": idiom,
                "scale": f"{scale}x",
                "size": f"{points:g}x{points:g}",
            }
        )

    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    (ICON_SET / "Contents.json").write_text(json.dumps(contents, indent=2) + "\n")


def draw_background(image: Image.Image) -> None:
    """A vertical accent-to-deep gradient, drawn a row at a time."""
    draw = ImageDraw.Draw(image)
    for y in range(CANVAS):
        t = y / (CANVAS - 1)
        colour = tuple(round(ACCENT[i] + (ACCENT_DEEP[i] - ACCENT[i]) * t) for i in range(3))
        draw.line([(0, y), (CANVAS, y)], fill=colour)


def leaf_outline(half_width_ratio: float, length: float, samples: int = 240) -> list[tuple[float, float]]:
    """A vesica (two-circle lens) leaf, centred on the origin, pointing up.

    `length` is the tip-to-tip distance; `half_width_ratio` is the leaf's
    half-width as a fraction of that length. Expressed as circle geometry
    rather than a Bezier so the silhouette is exactly symmetrical.
    """
    half_length = length / 2
    half_width = length * half_width_ratio
    # Circle through both tips (0, +/-half_length) and one flank (+/-half_width, 0).
    radius = (half_length**2 + half_width**2) / (2 * half_width)
    offset = radius - half_width  # centre distance from the axis
    theta = math.atan2(half_length, offset)

    points: list[tuple[float, float]] = []
    # Right flank: arc of the circle centred at (-offset, 0).
    for i in range(samples + 1):
        angle = -theta + (2 * theta) * i / samples
        points.append((-offset + radius * math.cos(angle), radius * math.sin(angle)))
    # Left flank: arc of the circle centred at (+offset, 0).
    for i in range(samples + 1):
        angle = (math.pi - theta) + (2 * theta) * i / samples
        points.append((offset + radius * math.cos(angle), radius * math.sin(angle)))
    return points


def rotate_translate(points, degrees: float, dx: float, dy: float):
    radians = math.radians(degrees)
    cos_a, sin_a = math.cos(radians), math.sin(radians)
    return [(x * cos_a - y * sin_a + dx, x * sin_a + y * cos_a + dy) for x, y in points]


def main() -> None:
    image = Image.new("RGB", (CANVAS, CANVAS), ACCENT)
    draw_background(image)
    draw = ImageDraw.Draw(image)

    centre = CANVAS / 2
    # Lifted slightly: the stem hangs below the leaf, so a mark centred on
    # geometry alone sits optically low in the rounded-square mask.
    centre_y = centre - CANVAS * 0.035
    leaf_length = CANVAS * 0.62
    tilt = 20.0  # degrees clockwise, so the leaf leans like a real one

    leaf = rotate_translate(leaf_outline(0.30, leaf_length), tilt, centre, centre_y)
    draw.polygon(leaf, fill=PAPER)

    # The midrib as a dotted survey line — the "map" half of the idea. Drawn in
    # the background gradient's own deep tone so it reads as cut out of the leaf.
    half_length = leaf_length / 2
    inset = half_length * 0.80
    dot_radius = CANVAS * 0.011
    dot_count = 7
    for i in range(dot_count):
        t = i / (dot_count - 1)
        y = -inset + (2 * inset) * t
        (x, y) = rotate_translate([(0.0, y)], tilt, centre, centre_y)[0]
        draw.ellipse(
            [x - dot_radius, y - dot_radius, x + dot_radius, y + dot_radius],
            fill=ACCENT_DEEP,
        )

    # A short stem continuing past the lower tip, so the leaf is planted rather
    # than floating.
    stem_width = int(CANVAS * 0.022)
    stem_start = rotate_translate([(0.0, half_length * 0.86)], tilt, centre, centre_y)[0]
    stem_end = rotate_translate([(0.0, half_length * 1.30)], tilt, centre, centre_y)[0]
    draw.line([stem_start, stem_end], fill=PAPER, width=stem_width)

    write_icon_set(image)
    print(f"wrote {len(SLOTS)} icon slots + Contents.json into {ICON_SET}")


if __name__ == "__main__":
    main()
