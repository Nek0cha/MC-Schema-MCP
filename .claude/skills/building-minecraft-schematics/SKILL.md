---
name: building-minecraft-schematics
description: Use when constructing Minecraft builds or .schem schematics through the mc-schema-mcp server (createProject, fillBox, cylinder, wall, outlineBox, setBlocks, exportSchematic) - towers, castles, houses, walls, roofs, interiors - or when a generated build comes out flat, boxy, monotonous, or the footprint overflows its size budget.
---

# Building Minecraft Schematics

## Overview

mc-schema-mcp writes into a voxel grid where **the last write to a coordinate wins**. Every build therefore reduces to two decisions: *what shapes to draw* and *in what order*. Visual quality comes from silhouette, rhythm and depth — not from block variety.

## When to Use

- Any build driven through mc-schema-mcp tools
- A finished build reads as flat, boxy, or monotonous and you need to know why
- A build must fit inside a fixed footprint (e.g. "16x16")

Not for: single-block edits, or importing an existing schematic.

## Six Design Principles

**1. Silhouette first.** A box is invisible. Break the outline before choosing any material — corner turrets, setbacks, overhangs, or one taller feature volume. If the shape doesn't read as a black cutout, no amount of texture will save it.

**2. One rhythm, everywhere.** Pick a floor height `H` (8 is a good default) and derive everything from it: floors at `n*H`, cornice bands at `n*H - 1`, windows at `n*H + 2 .. n*H + 5`. Mismatched periods are what "sloppy" actually looks like.

**3. Three material layers.** Primary 60% + weathering 35% (weighted random, same colour family) + accent (a single block, no randomness). **Use the accent only on horizontal lines** — bands, sills, floors, roofs. Randomizing the accent destroys the line it was there to draw.

**4. Work only on visible faces.** If a corner tower occults a wall span, put nothing there. Compute the visible span before placing openings; effort spent on hidden faces is effort not spent on the silhouette.

**5. One block of depth.** Flat walls never look good. Protruding or recessed bands, stairs blocks (half-block shadow), and recessed window reveals create the shading that the eye reads as detail.

**6. Align light to structure.** Place lanterns and torches on coordinates that already matter — band levels, pillar positions, the stair newel. Scattered light looks cheap.

## Build Order

```
foundation -> shell (towers, then walls) -> carve interior with air
 -> floors -> decorative bands -> openings -> stairs -> roofs -> lighting
```

**The ordering rule:** later writes overwrite earlier ones. An `air` carve must run *after* whatever it deletes and *before* whatever it must not touch. Write the carve order down before building — it is part of the design, not an afterthought.

## Tool Quick Reference

| Tool | Use for | Gotcha |
|---|---|---|
| `createProject` / `switchProject` | start a build | name accepts letters, digits, space, `-`, `_` only |
| `fillBox` | floors, bands, bulk solids, **and deletion** | fill with `minecraft:air` to carve |
| `outlineBox` | hollow box shell | includes top and bottom faces; for an open-topped room use four `wall` calls |
| `wall` | one vertical wall between two points | four of these = a room with no floor or ceiling |
| `cylinder` | towers, roof discs, rings | `hollow:true` is an open-ended tube — no caps |
| `sphere` | domes | hollow spheres need a floor added separately |
| `line` | edges, diagonals, ridge beams | |
| `setBlock` / `setBlocks` | oriented blocks (stairs, torches) and scattered detail | generate the coordinates with a script |
| `getBuildInfo` | bounding box + block counts | the only way to verify the footprint |
| `exportSchematic` | writes `./output/<name>.schem` | fences, glass panes, iron bars and walls have their `north/south/east/west/up` connection properties auto-computed from neighbors at export time — don't set them by hand, they'll be overwritten |

## Common Mistakes

| Mistake | Fix |
|---|---|
| Non-integer cylinder radius overflows the footprint | `r=3.5` centred at `x=3` reaches `x=-1`. Keep radii integral when there is a size budget, then confirm with `getBuildInfo` |
| Stairs face the wrong way | `facing` is the direction you **ascend**. Set `half` explicitly: `bottom` for a step, `top` for an inverted corbel |
| A cylinder and a straight wall intersect and nobody planned it | Decide up front: carve the intersection to air (open alcove) or keep it (interior partition) |
| `hollow: true` leaves a tower open at both ends | Add a solid `cylinder` of height 1 for the floor or ceiling disc |
| Hand-typed `setBlocks` coordinates | Generate them with a script — see `scripts/spiral_stairs.py` |
| An `air` carve deleted something already placed | Move it earlier in the order, or re-place what it removed |
| Windows on a face hidden by an adjacent mass | Compute visible spans first (formula in `references/recipes.md`) |

## Checklist

- [ ] Silhouette decided before any material
- [ ] Floor height `H` chosen; floors, bands and windows all derived from it
- [ ] Palette is primary + weathering + one non-random accent
- [ ] Visible spans computed before placing openings
- [ ] Carve order written down before building
- [ ] `getBuildInfo` bounding box matches the size budget
- [ ] `exportSchematic` run and the output file confirmed on disk

## Reference

Copy-ready palettes, the spiral staircase formula, conical roof taper tables, the two-call cornice trick, crenellation patterns, the alcove trick, and the visible-span formula live in `references/recipes.md`.
