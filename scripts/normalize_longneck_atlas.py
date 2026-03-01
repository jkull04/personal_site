#!/usr/bin/env python3
"""Normalize all dino walk atlases from final source sprites with stable frame anchoring."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
FRAME_COUNT = 8
PADDING = 20
HORIZONTAL_INSET = 14
COMPONENT_ALPHA_THRESHOLD = 96


@dataclass(frozen=True)
class SpriteConfig:
    key: str
    source: Path
    output: Path
    window_pad_x: int = 0


@dataclass
class Component:
    pixels: List[Tuple[int, int]]
    area: int
    bbox: Tuple[int, int, int, int]


@dataclass
class PreparedFrame:
    image: Image.Image
    anchor_x: float
    foot_y: int


SPRITES: Tuple[SpriteConfig, ...] = (
    SpriteConfig(
        key="stego",
        source=ROOT / "assets" / "source-art" / "final-steg.png",
        output=ROOT / "assets" / "sprites" / "stegosaurus-walk-atlas.png",
    ),
    SpriteConfig(
        key="raptor",
        source=ROOT / "assets" / "source-art" / "final-raptor.png",
        output=ROOT / "assets" / "sprites" / "raptor-walk-atlas.png",
    ),
    SpriteConfig(
        key="longneck",
        source=ROOT / "assets" / "source-art" / "final-longneck.png",
        output=ROOT / "assets" / "sprites" / "marble-brach-walk-atlas.png",
        window_pad_x=40,
    ),
)


def contiguous_ranges(mask: np.ndarray, min_len: int = 1) -> List[Tuple[int, int]]:
    ranges: List[Tuple[int, int]] = []
    start = None
    for idx, value in enumerate(mask.tolist()):
        if value and start is None:
            start = idx
        elif not value and start is not None:
            if idx - start >= min_len:
                ranges.append((start, idx - 1))
            start = None
    if start is not None and len(mask) - start >= min_len:
        ranges.append((start, len(mask) - 1))
    return ranges


def connected_components(mask: np.ndarray) -> List[Component]:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=np.uint8)
    components: List[Component] = []

    for y in range(height):
        for x in range(width):
            if not mask[y, x] or visited[y, x]:
                continue

            stack = [(y, x)]
            visited[y, x] = 1
            pixels: List[Tuple[int, int]] = []
            min_x = max_x = x
            min_y = max_y = y

            while stack:
                cy, cx = stack.pop()
                pixels.append((cy, cx))
                min_x = min(min_x, cx)
                max_x = max(max_x, cx)
                min_y = min(min_y, cy)
                max_y = max(max_y, cy)

                for ny in (cy - 1, cy, cy + 1):
                    if ny < 0 or ny >= height:
                        continue
                    for nx in (cx - 1, cx, cx + 1):
                        if nx < 0 or nx >= width or (ny == cy and nx == cx):
                            continue
                        if visited[ny, nx] or not mask[ny, nx]:
                            continue
                        visited[ny, nx] = 1
                        stack.append((ny, nx))

            components.append(
                Component(
                    pixels=pixels,
                    area=len(pixels),
                    bbox=(min_x, min_y, max_x, max_y),
                )
            )

    return components


def detect_frame_windows(alpha: np.ndarray) -> List[Tuple[int, int, int, int]]:
    row_ranges = contiguous_ranges((alpha >= COMPONENT_ALPHA_THRESHOLD).any(axis=1), min_len=40)
    if len(row_ranges) < 2:
        raise ValueError("Could not detect two animation rows in source sprite sheet.")

    # Keep the two strongest rows and preserve top-to-bottom order.
    row_ranges = sorted(row_ranges, key=lambda r: (r[1] - r[0] + 1), reverse=True)[:2]
    row_ranges = sorted(row_ranges, key=lambda r: r[0])

    windows: List[Tuple[int, int, int, int]] = []
    width = alpha.shape[1]

    for row_start, row_end in row_ranges:
        row_height = row_end - row_start + 1
        torso_start = row_start + int(row_height * 0.25)
        torso_end = row_start + int(row_height * 0.70)
        torso_mask = (alpha[torso_start : torso_end + 1, :] >= COMPONENT_ALPHA_THRESHOLD).any(axis=0)
        col_ranges = contiguous_ranges(torso_mask, min_len=20)

        if len(col_ranges) < 4:
            step = width // 4
            centers = [step // 2 + i * step for i in range(4)]
        else:
            col_ranges = sorted(col_ranges, key=lambda c: c[0])[:4]
            centers = [(left + right) // 2 for left, right in col_ranges]

        for idx, center in enumerate(centers):
            if idx == 0:
                half = (centers[1] - centers[0]) // 2
                left = max(0, center - half)
            else:
                left = (centers[idx - 1] + center) // 2

            if idx == len(centers) - 1:
                half = (centers[-1] - centers[-2]) // 2
                right = min(width - 1, center + half)
            else:
                right = (center + centers[idx + 1]) // 2

            top = max(0, row_start - 90)
            bottom = min(alpha.shape[0] - 1, row_end + 90)
            windows.append((left, top, right, bottom))

    if len(windows) != FRAME_COUNT:
        raise ValueError(f"Expected {FRAME_COUNT} frame windows, found {len(windows)}.")

    return windows


def extract_main_component_frame(
    source: Image.Image, window: Tuple[int, int, int, int], window_pad_x: int = 0
) -> Image.Image:
    left, top, right, bottom = window
    if window_pad_x > 0:
        left = max(0, left - window_pad_x)
        right = min(source.width - 1, right + window_pad_x)
    crop = source.crop((left, top, right + 1, bottom + 1)).convert("RGBA")
    alpha = np.array(crop.getchannel("A"))
    mask = alpha >= COMPONENT_ALPHA_THRESHOLD
    comps = connected_components(mask)
    if not comps:
        raise ValueError("No connected component found in detected frame window.")

    main = max(comps, key=lambda comp: comp.area)
    keep = np.zeros_like(mask, dtype=np.uint8)
    for py, px in main.pixels:
        keep[py, px] = 1

    ys, xs = np.nonzero(keep)
    if len(xs) == 0:
        raise ValueError("Connected component extraction produced an empty frame.")

    bx0, bx1 = int(xs.min()), int(xs.max())
    by0, by1 = int(ys.min()), int(ys.max())
    rgba = np.array(crop)
    rgba[:, :, 3][keep == 0] = 0

    return Image.fromarray(rgba).crop((bx0, by0, bx1 + 1, by1 + 1))


def prepare_frames(config: SpriteConfig) -> List[PreparedFrame]:
    if not config.source.exists():
        raise FileNotFoundError(f"Source sprite sheet not found: {config.source}")

    with Image.open(config.source) as source_raw:
        source = source_raw.convert("RGBA")

    alpha = np.array(source.getchannel("A"))
    windows = detect_frame_windows(alpha)
    frames: List[PreparedFrame] = []

    for window in windows:
        frame = extract_main_component_frame(source, window, window_pad_x=config.window_pad_x)
        frame_alpha = np.array(frame.getchannel("A"))
        ys, xs = np.nonzero(frame_alpha > 0)
        if len(xs) == 0:
            raise ValueError("Prepared frame is empty after component extraction.")

        height = frame.height
        width = frame.width
        band_top = int(height * 0.30)
        band_bottom = int(height * 0.72)
        band_mask = np.zeros_like(frame_alpha, dtype=bool)
        band_mask[band_top:band_bottom, :] = True
        torso = np.nonzero((frame_alpha > 0) & band_mask)

        if len(torso[1]) > 0:
            anchor_x = float(np.median(torso[1]))
        else:
            anchor_x = float(np.median(xs))

        foot_y = int(ys.max())
        frames.append(PreparedFrame(image=frame, anchor_x=anchor_x, foot_y=foot_y))

    if len(frames) != FRAME_COUNT:
        raise ValueError(f"Expected {FRAME_COUNT} prepared frames, found {len(frames)}.")
    return frames


def normalize_one(config: SpriteConfig) -> Tuple[int, int, int, int]:
    with Image.open(config.source) as source_raw:
        source = source_raw.convert("RGBA")

    frames = prepare_frames(config)
    max_w = max(frame.image.width for frame in frames)
    max_h = max(frame.image.height for frame in frames)
    max_foot = max(frame.foot_y for frame in frames)
    anchor_values = [frame.anchor_x for frame in frames]
    anchor_max = max(anchor_values)
    anchor_min = min(anchor_values)
    anchor_span = int(round(anchor_max - anchor_min))

    cell_w = max_w + (PADDING * 2) + HORIZONTAL_INSET + anchor_span
    cell_h = max_h + (PADDING * 2)
    atlas = Image.new("RGBA", (cell_w * FRAME_COUNT, cell_h), (0, 0, 0, 0))

    for idx, frame in enumerate(frames):
        shift_x = int(round(anchor_max - frame.anchor_x))
        paste_x = (idx * cell_w) + PADDING + HORIZONTAL_INSET + shift_x
        paste_y = PADDING + (max_foot - frame.foot_y)
        atlas.alpha_composite(frame.image, (paste_x, paste_y))

    atlas.save(config.output)
    return source.width, source.height, atlas.width, atlas.height


def resolve_targets(sprite_key: str) -> Iterable[SpriteConfig]:
    if sprite_key == "all":
        return SPRITES
    for config in SPRITES:
        if config.key == sprite_key:
            return (config,)
    raise ValueError(f"Unknown sprite key: {sprite_key}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sprite",
        choices=["all", "stego", "raptor", "longneck"],
        default="all",
        help="Which sprite atlas to normalize.",
    )
    args = parser.parse_args()

    for config in resolve_targets(args.sprite):
        sw, sh, ow, oh = normalize_one(config)
        print(
            f"{config.key}: normalized {config.output}\n"
            f"source={config.source} ({sw}x{sh}) -> output={ow}x{oh}\n"
            f"frames={FRAME_COUNT}, padding={PADDING}, horizontal_inset={HORIZONTAL_INSET}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
