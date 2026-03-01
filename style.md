# style.md — Living Ruins Pixel Theme (9-Color Core Palette)

Theme intent: **Classical museum restraint + true pixel-art rules** on a light background, with **marble dinos** (lighter) and **travertine Colosseum** (darker), plus **laurel olive** as the single primary accent.

---

## Core Palette (9 colors)

### 1) Background
- **BG Cream** — `#F7F5F0`  
  Use: page background, negative space. Keep large areas flat or with an *extremely subtle* vertical gradient (optional).

### 2–6) Marble Ramp (Dinos / UI “stone”)
- **Marble Highlight** — `#F2F1EA`  
- **Marble Light** — `#DDD8CC`  
- **Marble Base** — `#C3BBAA`  
- **Marble Shadow** — `#978E7E`  
- **Marble Deep / Outline** — `#5F584E`  
Use: dinos, stone UI slabs, typographic ornaments, subtle dividers.  
Rules: dinos should bias toward the top 3 tones; use shadows sparingly for creases + underside only.

### 7–8) Travertine Structure (Colosseum)
- **Travertine Base** — `#D2B791`  
- **Travertine Deep Structure** — `#6B4E34`  
Use: Colosseum body (base), arches/voids/interior cuts (deep).  
Rule: Colosseum should read darker than dinos primarily via **stronger deep structure usage**.

### 9) Accent
- **Laurel Olive** — `#6F7A5A`  
Use: active nav underline, wreath icon, small UI indicators, hover borders.  
Rule: keep total on-screen usage **~8–12% max**.

---

## Contrast + Hierarchy Rules

1. **BG is the lightest large surface**.  
2. **Dinos are lighter than the Colosseum**:  
   - dinos = mostly `#F2F1EA / #DDD8CC / #C3BBAA`  
   - colosseum = heavy `#D2B791` with deep cuts in `#6B4E34`
3. Avoid pure black anywhere; the deepest “black” is `#6B4E34` (architecture) or `#5F584E` (outline).

---

## Interaction States (recommended)

### Stone Button (default)
- Fill: `#DDD8CC`
- Border: `#5F584E`
- Text: `#5F584E`

### Hover
- Border (or underline): `#6F7A5A`
- Optional: 1px inset shadow in `#978E7E`

### Active
- Underline / small wreath glyph: `#6F7A5A`

Do **not** fill buttons with green; green is symbolic, not structural.

---

## Pixel Integrity Rules (non-negotiable)

- Hard pixel edges only
- No blur, no glow, no soft shadows
- No anti-aliasing
- No texture noise / speckle
- Shading is **flat steps**, not gradients
- Limit per-asset to the palette above (no extra colors)

---

## “Lightly Aged” Marble Treatment (dinos)

- Chips: **2–4px clusters** on silhouette edges only (use `#978E7E`, rarely `#5F584E`)
- No veining patterns
- Optional single small “stain” per sprite: **3–6px** blocky patch using `#978E7E`

---

## Optional Extensions (not part of the 9-color core)

If you later want a *secondary* metallic accent, add one bronze tone pair:
- Bronze — `#8C6A3C`
- Dark Bronze — `#5A4326`

Use only for tiny highlights (icons, gate details), not broad UI fills.