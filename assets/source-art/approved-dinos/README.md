# Approved dinosaur animation sources

Manually refined in Piskel and approved for production on 2026-10-20.

- Raptor: separate eight-frame walking and three-frame standing projects, 56 × 30 pixels.
- Stegosaurus: separate eight-frame walking and three-frame standing projects, 56 × 35 pixels. Use `stegosaurus-walk.piskel` and `stegosaurus-standing.piskel`; the older master is retained only as an archive. Standing and walking sources share ground row 31 and export directly without translation or resampling. The standing legs have fuller calves and feet matching the walking proportions.
- Longneck: 54 × 72 pixels. Master frames 0–7 walk; standing uses frames 7, 8, 9.

Standing frames are planted, breathing, and blinking. Runtime atlases live in `assets/sprites`; WebP exports are lossless at native resolution. The legacy `-2x.webp` walking filenames are retained for compatibility.

These are the current source drawings. Do not regenerate the longneck from the older PNG source using `normalize_longneck_atlas.py`, which predates these refinements.
