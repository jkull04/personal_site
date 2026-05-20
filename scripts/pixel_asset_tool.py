#!/usr/bin/env python3
"""Convert and validate generated images as constrained pixel-art assets."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]

PALETTES = {
    "adaptive": (),
    "marble": (
        "#F2F1EA",
        "#DDD8CC",
        "#C3BBAA",
        "#978E7E",
        "#5F584E",
    ),
    "site": (
        "#F7F5F0",
        "#F2F1EA",
        "#DDD8CC",
        "#C3BBAA",
        "#978E7E",
        "#5F584E",
        "#D2B791",
        "#6B4E34",
        "#6F7A5A",
    ),
    "stone": (
        "#F7F5F0",
        "#F2F1EA",
        "#DDD8CC",
        "#C3BBAA",
        "#978E7E",
        "#5F584E",
        "#D2B791",
        "#6B4E34",
    ),
}


def parse_size(value: str) -> tuple[int, int]:
    parts = value.lower().replace(" ", "").split("x")
    if len(parts) != 2:
        raise argparse.ArgumentTypeError(f"Invalid size: {value}")
    width, height = int(parts[0]), int(parts[1])
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError(f"Invalid size: {value}")
    return width, height


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    raw = value.lstrip("#")
    return (int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16))


def palette_rgb(name: str) -> tuple[tuple[int, int, int], ...]:
    return tuple(hex_to_rgb(value) for value in PALETTES[name])


def nearest_color(rgb: tuple[int, int, int], palette: tuple[tuple[int, int, int], ...]) -> tuple[int, int, int]:
    return min(
        palette,
        key=lambda candidate: (
            (rgb[0] - candidate[0]) ** 2
            + (rgb[1] - candidate[1]) ** 2
            + (rgb[2] - candidate[2]) ** 2
        ),
    )


def quantize_to_palette(
    image: Image.Image,
    palette: tuple[tuple[int, int, int], ...],
    alpha_threshold: int,
) -> Image.Image:
    source = image.convert("RGBA")
    output = Image.new("RGBA", source.size, (0, 0, 0, 0))
    src_px = source.load()
    out_px = output.load()

    for y in range(source.height):
        for x in range(source.width):
            r, g, b, a = src_px[x, y]
            if a < alpha_threshold:
                out_px[x, y] = (0, 0, 0, 0)
                continue
            nr, ng, nb = nearest_color((r, g, b), palette)
            out_px[x, y] = (nr, ng, nb, 255)

    return output


def quantize_adaptive(image: Image.Image, colors: int, alpha_threshold: int) -> Image.Image:
    source = image.convert("RGBA")
    matte = Image.new("RGB", source.size, hex_to_rgb("#F7F5F0"))
    matte.paste(source.convert("RGB"), mask=source.getchannel("A"))
    indexed = matte.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    rgb = indexed.convert("RGB")
    output = Image.new("RGBA", source.size, (0, 0, 0, 0))
    source_px = source.load()
    rgb_px = rgb.load()
    out_px = output.load()
    for y in range(source.height):
        for x in range(source.width):
            if source_px[x, y][3] < alpha_threshold:
                continue
            r, g, b = rgb_px[x, y]
            out_px[x, y] = (r, g, b, 255)
    return output


def convert_image(args: argparse.Namespace) -> int:
    with Image.open(args.input) as raw:
        image = raw.convert("RGBA")

    logical = image.resize(args.logical_size, Image.Resampling.BOX)
    if args.palette == "adaptive":
        indexed = quantize_adaptive(logical, args.max_colors, args.alpha_threshold)
    else:
        indexed = quantize_to_palette(logical, palette_rgb(args.palette), args.alpha_threshold)

    if args.output_size:
        result = indexed.resize(args.output_size, Image.Resampling.NEAREST)
    elif args.pixel_scale:
        width, height = indexed.size
        result = indexed.resize((width * args.pixel_scale, height * args.pixel_scale), Image.Resampling.NEAREST)
    else:
        result = indexed

    args.output.parent.mkdir(parents=True, exist_ok=True)
    save_kwargs: dict[str, object] = {}
    if args.output.suffix.lower() == ".webp":
        save_kwargs.update({"format": "WEBP", "lossless": True, "quality": 100, "exact": True, "method": 6})
    elif args.output.suffix.lower() == ".png":
        save_kwargs.update({"format": "PNG", "optimize": True, "compress_level": 9})
    result.save(args.output, **save_kwargs)
    print(f"converted: {args.input} -> {args.output} {result.width}x{result.height}")
    return 0


def check_palette(image: Image.Image, allowed: set[tuple[int, int, int]]) -> tuple[bool, str]:
    colors = set()
    bad_alpha = 0
    for r, g, b, a in image.getdata():
        if a not in (0, 255):
            bad_alpha += 1
        if a > 0:
            colors.add((r, g, b))
    non_palette = sorted(colors - allowed)
    ok = not non_palette and bad_alpha == 0
    return ok, f"colors={len(colors)} non_palette={len(non_palette)} semitransparent_pixels={bad_alpha}"


def check_pixel_blocks(image: Image.Image, pixel_scale: int) -> tuple[bool, str]:
    if pixel_scale <= 1:
        return True, "pixel_blocks=not_requested"
    if image.width % pixel_scale != 0 or image.height % pixel_scale != 0:
        return False, f"pixel_blocks=fail dimensions {image.width}x{image.height} not divisible by {pixel_scale}"

    px = image.load()
    bad_blocks = 0
    for y0 in range(0, image.height, pixel_scale):
        for x0 in range(0, image.width, pixel_scale):
            first = px[x0, y0]
            block_bad = False
            for y in range(y0, y0 + pixel_scale):
                for x in range(x0, x0 + pixel_scale):
                    if px[x, y] != first:
                        block_bad = True
                        bad_blocks += 1
                        break
                if block_bad:
                    break
    total = (image.width // pixel_scale) * (image.height // pixel_scale)
    return bad_blocks == 0, f"pixel_blocks={total - bad_blocks}/{total} scale={pixel_scale}"


def check_color_budget(image: Image.Image, max_colors: int | None) -> tuple[bool, str]:
    if max_colors is None:
        return True, "color_budget=not_requested"
    colors = {(r, g, b) for r, g, b, a in image.getdata() if a > 0}
    return len(colors) <= max_colors, f"color_budget={len(colors)}/{max_colors}"


def check_image(
    path: Path,
    palette_name: str,
    pixel_scale: int | None,
    max_colors: int | None,
) -> tuple[bool, str]:
    with Image.open(path) as raw:
        image = raw.convert("RGBA")

    if palette_name == "adaptive":
        palette_ok, palette_msg = check_color_budget(image, max_colors)
    else:
        palette_ok, palette_msg = check_palette(image, set(palette_rgb(palette_name)))
    blocks_ok, blocks_msg = check_pixel_blocks(image, pixel_scale or 1)
    ok = palette_ok and blocks_ok
    status = "PASS" if ok else "FAIL"
    return ok, f"{status}: {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} {image.width}x{image.height} {palette_msg} {blocks_msg}"


def check_images(args: argparse.Namespace) -> int:
    failures = 0
    for path in args.files:
        ok, message = check_image(path, args.palette, args.pixel_scale, args.max_colors)
        print(message)
        if not ok:
            failures += 1
    return 0 if failures == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    convert = subparsers.add_parser("convert", help="Downsample and palette-quantize one image into true pixel art.")
    convert.add_argument("input", type=Path)
    convert.add_argument("output", type=Path)
    convert.add_argument("--logical-size", type=parse_size, required=True, help="Target logical pixel grid, e.g. 384x256.")
    convert.add_argument("--output-size", type=parse_size, help="Optional exact output size after nearest-neighbor scaling.")
    convert.add_argument("--pixel-scale", type=int, help="Optional integer output scale when --output-size is omitted.")
    convert.add_argument("--palette", choices=sorted(PALETTES), default="site")
    convert.add_argument("--max-colors", type=int, default=24, help="Adaptive palette color budget.")
    convert.add_argument("--alpha-threshold", type=int, default=128)
    convert.set_defaults(func=convert_image)

    check = subparsers.add_parser("check", help="Validate palette, alpha, and optional integer pixel blocks.")
    check.add_argument("files", nargs="+", type=Path)
    check.add_argument("--palette", choices=sorted(PALETTES), default="site")
    check.add_argument("--pixel-scale", type=int)
    check.add_argument("--max-colors", type=int, help="Maximum opaque color count for --palette adaptive.")
    check.set_defaults(func=check_images)

    args = parser.parse_args()
    if getattr(args, "pixel_scale", None) is not None and args.pixel_scale <= 0:
        parser.error("--pixel-scale must be positive")
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
