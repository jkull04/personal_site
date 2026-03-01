#!/usr/bin/env python3
"""Validate an 8x1 sprite atlas for edge bleed and baseline stability."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image

STYLE_MARBLE_COLORS = {
    (0xF2, 0xF1, 0xEA),
    (0xDD, 0xD8, 0xCC),
    (0xC3, 0xBB, 0xAA),
    (0x97, 0x8E, 0x7E),
    (0x5F, 0x58, 0x4E),
}

DEFAULT_DISPLAY_CHECKS = {
    "marble-brach-walk-atlas.png": [(48, 63), (54, 72)],
    "longneck-walk-atlas.png": [(48, 63), (54, 72)],
    "stegosaurus-walk-atlas.png": [(65, 40), (74, 46)],
    "raptor-walk-atlas.png": [(50, 26), (56, 30)],
}


def analyze_frame(frame: Image.Image) -> Dict[str, object]:
    alpha = frame.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return {"empty": True}

    px = alpha.load()
    width, height = frame.size
    edge_touch = False
    foot_y = -1

    for y in range(height):
        for x in range(width):
            if px[x, y] == 0:
                continue
            if x == 0 or y == 0 or x == width - 1 or y == height - 1:
                edge_touch = True
            if y > foot_y:
                foot_y = y

    return {
        "empty": False,
        "bbox": bbox,
        "foot_y": foot_y,
        "edge_touch": edge_touch,
    }


def analyze_display_sampling(
    frame: Image.Image, width: int, height: int, alpha_threshold: int = 0
) -> Dict[str, object]:
    sampled = frame.resize((width, height), Image.Resampling.NEAREST)
    alpha = sampled.getchannel("A")
    px = alpha.load()
    min_x, min_y, max_x, max_y = width, height, -1, -1
    edge_touch = False

    for y in range(height):
        for x in range(width):
            if px[x, y] <= alpha_threshold:
                continue
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
            if x == 0 or y == 0 or x == width - 1 or y == height - 1:
                edge_touch = True

    if max_x < 0 or max_y < 0:
        return {"empty": True, "edge_touch": True}

    return {
        "empty": False,
        "bbox": (min_x, min_y, max_x, max_y),
        "foot_y": max_y,
        "edge_touch": edge_touch,
    }


def validate(
    path: Path,
    cols: int = 8,
    display_checks: List[Tuple[int, int]] | None = None,
    require_style_marble_palette: bool = False,
) -> Tuple[bool, str]:
    with Image.open(path) as raw:
        img = raw.convert("RGBA")
    if img.width % cols != 0:
        return False, f"FAIL: atlas width {img.width} is not divisible by cols={cols}"

    cell_w = img.width // cols
    cell_h = img.height
    frame_slices = [img.crop((idx * cell_w, 0, (idx + 1) * cell_w, cell_h)) for idx in range(cols)]

    baselines = []
    has_edge_touch = False
    details = []

    for idx, frame in enumerate(frame_slices):
        result = analyze_frame(frame)
        if result["empty"]:
            details.append(f"frame {idx}: EMPTY")
            continue

        bbox = result["bbox"]
        foot_y = result["foot_y"]
        edge_touch = result["edge_touch"]
        baselines.append(foot_y)
        has_edge_touch = has_edge_touch or edge_touch
        details.append(f"frame {idx}: bbox={bbox} foot_y={foot_y} edge_touch={edge_touch}")

    baseline_stable = len(set(baselines)) <= 1 if baselines else False
    ok = bool(baselines) and baseline_stable and not has_edge_touch

    display_reports: List[str] = []
    if display_checks:
        for disp_w, disp_h in display_checks:
            disp_edges = False
            disp_foots = []
            frame_reports = []
            for idx, frame in enumerate(frame_slices):
                sampled = analyze_display_sampling(frame, disp_w, disp_h)
                if sampled["empty"]:
                    disp_edges = True
                    frame_reports.append(f"frame {idx}: EMPTY")
                    continue
                disp_edges = disp_edges or bool(sampled["edge_touch"])
                disp_foots.append(int(sampled["foot_y"]))
                frame_reports.append(
                    f"frame {idx}: bbox={sampled['bbox']} foot_y={sampled['foot_y']} edge_touch={sampled['edge_touch']}"
                )
            foot_range = (max(disp_foots) - min(disp_foots)) if disp_foots else -1
            display_ok = (not disp_edges) and bool(disp_foots)
            ok = ok and display_ok
            display_reports.extend(
                [
                    f"display {disp_w}x{disp_h}: edge_touch_any={disp_edges}, foot_y_range={foot_range}",
                    *frame_reports,
                ]
            )

    status = "PASS" if ok else "FAIL"
    summary = [
        f"{status}: {path}",
        f"atlas={img.width}x{img.height}, cell={cell_w}x{cell_h}, cols={cols}",
        f"baseline_stable={baseline_stable}, edge_touch_any={has_edge_touch}",
        *details,
    ]
    if display_reports:
        summary.append("display_sampling_checks:")
        summary.extend(display_reports)

    if require_style_marble_palette:
        opaque_colors = {(r, g, b) for r, g, b, a in img.getdata() if a > 0}
        non_marble = sorted(opaque_colors - STYLE_MARBLE_COLORS)
        palette_ok = len(non_marble) == 0
        ok = ok and palette_ok
        summary.append(
            f"style_palette_check: ok={palette_ok}, opaque_color_count={len(opaque_colors)}, non_marble_count={len(non_marble)}"
        )
        if non_marble:
            sample = ", ".join(str(c) for c in non_marble[:12])
            summary.append(f"style_palette_non_marble_sample: {sample}")
    return ok, "\n".join(summary)


def parse_display_size(value: str) -> Tuple[int, int]:
    parts = value.lower().replace(" ", "").split("x")
    if len(parts) != 2:
        raise ValueError(f"Invalid --display-size value: {value}")
    w = int(parts[0])
    h = int(parts[1])
    if w <= 0 or h <= 0:
        raise ValueError(f"Invalid --display-size value: {value}")
    return (w, h)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--atlas",
        default="assets/sprites/marble-brach-walk-atlas.png",
        help="Path to the 8x1 atlas to validate.",
    )
    parser.add_argument("--cols", type=int, default=8, help="Number of frame columns.")
    parser.add_argument(
        "--display-size",
        action="append",
        default=[],
        help="Runtime display size check, format WIDTHxHEIGHT (repeatable).",
    )
    parser.add_argument(
        "--skip-display-checks",
        action="store_true",
        help="Skip runtime-size nearest-neighbor checks.",
    )
    parser.add_argument(
        "--require-style-marble-palette",
        action="store_true",
        help="Fail if opaque pixels contain colors outside style.md marble ramp.",
    )
    args = parser.parse_args()

    path = Path(args.atlas).resolve()
    if args.skip_display_checks:
        display_checks = None
    elif args.display_size:
        display_checks = [parse_display_size(v) for v in args.display_size]
    else:
        display_checks = DEFAULT_DISPLAY_CHECKS.get(path.name, [(32, 42), (36, 48)])

    ok, report = validate(
        path,
        cols=args.cols,
        display_checks=display_checks,
        require_style_marble_palette=args.require_style_marble_palette,
    )
    print(report)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
