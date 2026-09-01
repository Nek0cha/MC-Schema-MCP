# Geometry and Material Recipes

Parameterised recipes for mc-schema-mcp. Every coordinate below is a formula, not a fixed build.

---

## 1. Weighted Palettes

Pass an array of `{block, weight}` to any shape tool to get weighted-random texture. Weights need not sum to 100.

**Weathered stone** (primary + weathering)
```json
[{"block":{"id":"minecraft:stone_bricks"},"weight":60},
 {"block":{"id":"minecraft:cracked_stone_bricks"},"weight":20},
 {"block":{"id":"minecraft:mossy_stone_bricks"},"weight":15},
 {"block":{"id":"minecraft:cobblestone"},"weight":5}]
```
Accent: `minecraft:polished_deepslate` — Roof: `deepslate_tiles` 70 / `cracked_deepslate_tiles` 30

**Timber and plaster**
```json
[{"block":{"id":"minecraft:oak_planks"},"weight":55},
 {"block":{"id":"minecraft:stripped_oak_log"},"weight":25},
 {"block":{"id":"minecraft:spruce_planks"},"weight":20}]
```
Accent: `minecraft:dark_oak_log` — Roof: `dark_oak_stairs` / `deepslate_tiles`

**Desert sandstone**
```json
[{"block":{"id":"minecraft:sandstone"},"weight":55},
 {"block":{"id":"minecraft:smooth_sandstone"},"weight":25},
 {"block":{"id":"minecraft:cut_sandstone"},"weight":20}]
```
Accent: `minecraft:chiseled_sandstone` — Roof: `smooth_sandstone`

**Blackstone / infernal**
```json
[{"block":{"id":"minecraft:blackstone"},"weight":50},
 {"block":{"id":"minecraft:polished_blackstone"},"weight":30},
 {"block":{"id":"minecraft:cracked_polished_blackstone_bricks"},"weight":15},
 {"block":{"id":"minecraft:gilded_blackstone"},"weight":5}]
```
Accent: `minecraft:polished_blackstone_bricks`

### Gradient weathering
Real structures decay from the ground up. Draw the same wall in three vertical segments with three palettes: bottom third moss-heavy, middle balanced, top nearly clean primary. Costs two extra calls and reads far more convincing than one uniform mix.

---

## 2. The Rhythm Table

Choose floor height `H` (use 8 unless there is a reason not to). For floor index `n` starting at 0:

| Element | Y |
|---|---|
| Floor slab | `n*H` |
| Window opening | `n*H + 2` .. `n*H + 5` |
| Cornice band | `n*H + (H-1)` |
| Ceiling / next floor | `(n+1)*H` |

`H = 8` gives a 7-block clear room — generous but not cavernous — and matches the spiral staircase below exactly one revolution per floor.

---

## 3. Cornice Band in Two Calls

A band around a rectangular volume, without enumerating the perimeter:

```
fillBox (x0, y, z0) -> (x1, y, z1)          accent block   # paint the whole slab
fillBox (x0+1, y, z0+1) -> (x1-1, y, z1-1)  minecraft:air  # carve the interior back out
```

**Warning:** the carve deletes everything else already sitting at that `y` inside the ring — stairs, pillars, furniture. Run bands *before* interior detail, or re-place what the carve removed.

For a cylindrical tower, the equivalent is one call: a `cylinder` at the same radius as the shell, `height: 1`, `hollow: true`, in the accent block. Matching the shell radius exactly guarantees the ring lands on the same cells.

---

## 4. Spiral Staircase

A 3x3 spiral around a solid central newel. **One revolution = 8 steps = 8 blocks of rise**, so with `H = 8` each floor is exactly one turn.

Ring cells, clockwise viewed from above (`+x` = east, `+z` = south), as offsets from the newel:

| i | offset (dx, dz) | stairs `facing` |
|---|---|---|
| 0 | (+1,  0) | south |
| 1 | (+1, +1) | west |
| 2 | ( 0, +1) | west |
| 3 | (-1, +1) | north |
| 4 | (-1,  0) | north |
| 5 | (-1, -1) | east |
| 6 | ( 0, -1) | east |
| 7 | (+1, -1) | south |

For each `y` in the run: `i = (y - y_start) % 8`, place a stair at `newel + offset[i]` with `facing[i]`. `facing` is the direction of travel, i.e. the direction you ascend — always derive it as the step from cell `i` to cell `i+1` rather than hardcoding it. Counter-clockwise: reverse the offset order and **recompute** the facings. Merely flipping each facing to its opposite desynchronises them by one cell and every other step points the wrong way.

Requirements:
- Newel: a solid 1x1 column from `y_start` to `y_end - 1`
- Clearance: the 3x3 ring must be air. Inside a hollow tower this means **interior radius >= 2, i.e. `cylinder` radius 3**
- The ring frequently crosses straight walls that pass near the tower. Carve the whole `3x3 x height` shaft to air *before* placing the newel and steps

Generate the block list with `scripts/spiral_stairs.py` rather than by hand.

---

## 5. Conical Roof

Stack solid `cylinder` discs of height 1, shrinking the radius each level. Slope is set by the decrement `d`:

| Look | `d` per level |
|---|---|
| Steep, fairy-tale | 0.55 |
| Balanced (~45 degrees) | 0.8 |
| Shallow, squat | 1.1 |

For base radius `R`, level `k` uses `r = R - d*k`, stopping when `r < 1`; finish with a single `setBlock` at the centre. Base radius 3, `d = 0.8`: **3.0 -> 2.2 -> 1.4 -> centre block**.

An eave that overhangs by using `r = R + 0.5` on the first disc looks better but **costs half a block of footprint on every side** — skip it when a size budget is in play.

Cap the tower with a solid `cylinder` of height 1 at radius `R - 0.1` below the roof, or the cone sits on an open tube.

---

## 6. Crenellations

Parapet at `y`, merlons at `y + 1`. Take the perimeter cells and keep every other one:

```python
merlon = ((x + z) % 2 == 0)
```

The parity term keeps corners consistent on all four sides — a plain `x % 2` breaks at the corners. For a circular tower, delete alternating cells from the existing shell ring instead of adding merlons: `setBlocks` the outermost cardinal and diagonal cells to `minecraft:air` at the top course.

---

## 7. The Alcove Trick

When corner cylinders overlap a rectangular room, do **not** carve doorways one by one. Instead:

1. Draw the corner `cylinder` shells
2. Draw the straight `wall`s
3. `fillBox` the entire room interior with `minecraft:air`

Step 3 erases every piece of tower shell that intruded into the room, leaving each tower open to the room as a round alcove — on every floor, in one call. Corner alcoves are also the best place to put lanterns (principle 6: they are structural coordinates).

---

## 8. Visible Span

Before placing a window on a wall plane, subtract what adjacent masses occult.

A cylinder of radius `R` centred at `(cx, cz)` covers, on the wall plane `z = zw`:

```
x in [ cx - sqrt(R^2 - d^2),  cx + sqrt(R^2 - d^2) ],   d = |zw - cz|
```

For angled views use the conservative `cx +/- R`. Two corner towers at `x = a` and `x = b` therefore leave a visible span of `x in [a + R + 1, b - R - 1]`. If that span is under 3 blocks wide, the wall is effectively invisible — move the detail budget to the towers instead.

---

## 9. Openings

| Floor | Fill | Why |
|---|---|---|
| Ground | `minecraft:iron_bars` | reads as defensive, and bars catch light differently from glass |
| Upper | `minecraft:glass_pane` | panes auto-connect into a lattice; a 4x4 grid looks like tracery |
| Entrance | `minecraft:air` + inverted stairs at the top corners | `half: "top"` stairs facing inward form an arch spring |

Put the opening's top two blocks below the cornice band and the band becomes the lintel for free — no separate frame calls needed.
