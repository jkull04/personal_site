#!/usr/bin/env python3
"""Generate optimized runtime images and validate size budgets."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class AssetSpec:
    source: Path
    output: Path
    output_format: str
    target_width: int | None = None
    target_height: int | None = None
    scale: float | None = None
    quality: int = 80
    lossless: bool = False
    resample: Image.Resampling = Image.Resampling.LANCZOS
    max_bytes: int = 0
    expected_width: int = 0
    expected_height: int = 0


def resized_dimensions(
    width: int,
    height: int,
    *,
    target_width: int | None,
    target_height: int | None,
    scale: float | None,
) -> tuple[int, int]:
    if target_width is not None and target_height is not None and target_width > 0 and target_height > 0:
        return target_width, target_height
    if target_width is not None and target_width > 0:
        out_w = target_width
        out_h = max(1, int(round(height * (target_width / width))))
        return out_w, out_h
    if scale is not None and scale > 0:
        out_w = max(1, int(round(width * scale)))
        out_h = max(1, int(round(height * scale)))
        return out_w, out_h
    return width, height


def compute_expected_size(
    source: Path, *, target_width: int | None, target_height: int | None, scale: float | None
) -> tuple[int, int]:
    with Image.open(source) as image:
        return resized_dimensions(
            image.width,
            image.height,
            target_width=target_width,
            target_height=target_height,
            scale=scale,
        )


def resolve_source_path(*candidates: Path) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate

    tried = ", ".join(str(candidate.relative_to(ROOT)) for candidate in candidates)
    raise FileNotFoundError(f"Missing source image. Tried: {tried}")


def specs() -> tuple[AssetSpec, ...]:
    home = ROOT / "assets" / "illustrations" / "runtime"
    sprites = ROOT / "assets" / "sprites"
    images = ROOT / "assets" / "images"
    icons = ROOT / "assets" / "icons"
    headshot_source = resolve_source_path(
        images / "headshot-square.png",
        images / "headshot-square.jpg",
        images / "headshot-square.jpeg",
    )

    definitions: list[AssetSpec] = [
        AssetSpec(
            source=home / "hero-home-arena.png",
            output=home / "hero-home-arena-960.webp",
            output_format="WEBP",
            target_width=960,
            quality=76,
            max_bytes=180_000,
        ),
        AssetSpec(
            source=home / "hero-home-arena.png",
            output=home / "hero-home-arena-1536.webp",
            output_format="WEBP",
            target_width=1536,
            quality=80,
            max_bytes=420_000,
        ),
        AssetSpec(
            source=home / "hero-projects-forum.png",
            output=home / "hero-projects-forum-960.webp",
            output_format="WEBP",
            target_width=960,
            quality=76,
            max_bytes=180_000,
        ),
        AssetSpec(
            source=home / "hero-projects-forum.png",
            output=home / "hero-projects-forum-1536.webp",
            output_format="WEBP",
            target_width=1536,
            quality=80,
            max_bytes=420_000,
        ),
        AssetSpec(
            source=home / "hero-writings-pantheon.png",
            output=home / "hero-writings-pantheon-960.webp",
            output_format="WEBP",
            target_width=960,
            quality=76,
            max_bytes=180_000,
        ),
        AssetSpec(
            source=home / "hero-writings-pantheon.png",
            output=home / "hero-writings-pantheon-1536.webp",
            output_format="WEBP",
            target_width=1536,
            quality=80,
            max_bytes=420_000,
        ),
        AssetSpec(
            source=home / "hero-contact-delphi.png",
            output=home / "hero-contact-delphi-960.webp",
            output_format="WEBP",
            target_width=960,
            quality=76,
            max_bytes=180_000,
        ),
        AssetSpec(
            source=home / "hero-contact-delphi.png",
            output=home / "hero-contact-delphi-1536.webp",
            output_format="WEBP",
            target_width=1536,
            quality=80,
            max_bytes=420_000,
        ),
        AssetSpec(
            source=sprites / "stegosaurus-walk-atlas.png",
            output=sprites / "stegosaurus-walk-atlas-2x.webp",
            output_format="WEBP",
            scale=0.5,
            quality=88,
            resample=Image.Resampling.BILINEAR,
            max_bytes=220_000,
        ),
        AssetSpec(
            source=sprites / "raptor-walk-atlas.png",
            output=sprites / "raptor-walk-atlas-2x.webp",
            output_format="WEBP",
            scale=0.5,
            quality=88,
            resample=Image.Resampling.BILINEAR,
            max_bytes=190_000,
        ),
        AssetSpec(
            source=sprites / "marble-brach-walk-atlas.png",
            output=sprites / "marble-brach-walk-atlas-2x.webp",
            output_format="WEBP",
            scale=0.5,
            quality=88,
            resample=Image.Resampling.BILINEAR,
            max_bytes=210_000,
        ),
        AssetSpec(
            source=headshot_source,
            output=images / "headshot-square-640.webp",
            output_format="WEBP",
            target_width=640,
            quality=78,
            max_bytes=95_000,
        ),
        AssetSpec(
            source=icons / "laurel-circle.png",
            output=icons / "favicon-32.png",
            output_format="PNG",
            target_width=32,
            target_height=32,
            lossless=True,
            max_bytes=8_000,
        ),
    ]

    populated: list[AssetSpec] = []
    for spec in definitions:
        expected_width, expected_height = compute_expected_size(
            spec.source,
            target_width=spec.target_width,
            target_height=spec.target_height,
            scale=spec.scale,
        )
        populated.append(
            AssetSpec(
                source=spec.source,
                output=spec.output,
                output_format=spec.output_format,
                target_width=spec.target_width,
                target_height=spec.target_height,
                scale=spec.scale,
                quality=spec.quality,
                lossless=spec.lossless,
                resample=spec.resample,
                max_bytes=spec.max_bytes,
                expected_width=expected_width,
                expected_height=expected_height,
            )
        )

    return tuple(populated)


def build_image(spec: AssetSpec) -> None:
    if not spec.source.exists():
        raise FileNotFoundError(f"Missing source image: {spec.source}")

    spec.output.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(spec.source) as source_image:
        source = source_image.convert("RGBA")
        out_w, out_h = resized_dimensions(
            source.width,
            source.height,
            target_width=spec.target_width,
            target_height=spec.target_height,
            scale=spec.scale,
        )
        rendered = source.resize((out_w, out_h), spec.resample) if (out_w, out_h) != source.size else source

        if spec.output_format.upper() == "WEBP":
            rendered.save(
                spec.output,
                format="WEBP",
                quality=100 if spec.lossless else spec.quality,
                lossless=spec.lossless,
                method=6,
                exact=True,
            )
            return

        if spec.output_format.upper() == "PNG":
            rendered.save(
                spec.output,
                format="PNG",
                optimize=True,
                compress_level=9,
            )
            return

        raise ValueError(f"Unsupported output format: {spec.output_format}")


def validate_asset(spec: AssetSpec) -> tuple[bool, str]:
    if not spec.output.exists():
        return False, f"missing output: {spec.output.relative_to(ROOT)}"

    size = spec.output.stat().st_size
    if spec.max_bytes > 0 and size > spec.max_bytes:
        return (
            False,
            (
                f"size over budget: {spec.output.relative_to(ROOT)} "
                f"({size} bytes > {spec.max_bytes} bytes)"
            ),
        )

    with Image.open(spec.output) as image:
        width, height = image.size

    if width != spec.expected_width or height != spec.expected_height:
        return (
            False,
            (
                f"dimension mismatch: {spec.output.relative_to(ROOT)} "
                f"({width}x{height} != {spec.expected_width}x{spec.expected_height})"
            ),
        )

    return (
        True,
        (
            f"ok: {spec.output.relative_to(ROOT)} "
            f"{width}x{height} {size} bytes"
        ),
    )


def build_all(image_specs: Iterable[AssetSpec]) -> None:
    for spec in image_specs:
        build_image(spec)
        print(f"built: {spec.output.relative_to(ROOT)}")


def check_all(image_specs: Iterable[AssetSpec]) -> int:
    failures = 0
    for spec in image_specs:
        ok, message = validate_asset(spec)
        print(message)
        if not ok:
            failures += 1
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate optimized runtime assets and fail on missing/oversized files.",
    )
    args = parser.parse_args()

    image_specs = specs()

    if args.check:
        return 0 if check_all(image_specs) == 0 else 1

    build_all(image_specs)
    failures = check_all(image_specs)
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
