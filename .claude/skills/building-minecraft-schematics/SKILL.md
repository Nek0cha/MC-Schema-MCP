---
name: building-minecraft-schematics
description: Use when constructing Minecraft builds or .schem schematics through the mc-schema-mcp server (createProject, fillBox, cylinder, wall, outlineBox, setBlocks, copyRegion, placeTemplate, batch, decayRegion, renderView, previewBuild, exportSchematic, setMapSettings, addMarkers, validateRaidMap, exportRaidMap) - towers, castles, houses, walls, roofs, interiors - or when a generated build comes out flat, boxy, monotonous, or the footprint overflows its size budget.
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
| `copyRegion` / `stackRegion` | repeat a wing, a floor, a bay of columns; `copyRegion` can also flip/rotate | stairs, doors, logs and signs turn with the copy; unset cells keep the destination, explicit air overwrites it |
| `replaceInRegion` | material variants (`*_stairs` -> another wood) | `keepProperties: "auto"` keeps facing/half only when both ids end with the same word |
| `clearRegion` | remove a box | `mode: "air"` writes explicit air so it later carves terrain |
| `decayRegion` | ruins: crumbles blocks (more at the top) and drops rubble | do it before validating; it can block passages |
| `saveTemplate` / `placeTemplate` / `listTemplates` / `deleteTemplate` | reuse a finished building across projects | the anchor is what lands on `at` |
| `batch` | many operations in one call | validated up front; a runtime error stops it but keeps earlier operations; saved once |
| `getBuildInfo` | bounding box + block counts | the only way to verify the footprint; also lists isolated panes/bars (see Common Mistakes) |
| `renderView` | a PNG of the build from any preset view (`iso_*`, `top`, `north`...), optionally framed on a `focus` box and cut at `clipY` | the only way to actually see the build; see "Look, Then Fix" below |
| `previewBuild` | URL of an interactive 3D viewer for a human (orbit, cut, hover for coordinates); `/2d` for layers | you cannot see it yourself, use `renderView` |
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
| Glass panes or iron bars on a cylinder or diagonal wall render as thin posts | Panes only connect to a neighbour on the four horizontal sides. Check the `Warning: ... isolated ...` line from `getBuildInfo`, then use full glass blocks on diagonal/curved stretches or put a solid block or another pane beside each flagged one. Fences and walls are not flagged: a lone post is normal for them |
| Windows on a face hidden by an adjacent mass | Compute visible spans first (formula in `references/recipes.md`) |

## Building Large Maps

Placing a whole district block by block takes thousands of calls and the conversation forgets what was placed. Build each building once, then stamp it:

1. Build one building carefully in a small sandbox project.
2. `saveTemplate` it with a name and an anchor. Put the anchor on **the ground in front of the main entrance**, so rotated copies line up with the road.
3. In the map project, use `batch` with many `placeTemplate` operations (vary `rotate` and `flip`, and `seed` for reproducibility).
4. Add variety with `replace` on `placeTemplate` (e.g. oak -> spruce, matching the template's original orientation), or `replaceInRegion` afterwards.
5. Ruin it with `decayRegion`, then check that doorways and stairs are not blocked. Decay first, validate after.

## Look, Then Fix

You can see the build with `renderView`, so do not design blind. After every stage (shell, interior, roof, lighting), look and correct before going on:

1. Overview: `renderView` with `view: "iso_se"`, then `iso_nw` (or another corner) so no side stays unseen. Judge the silhouette first: is it a recognisable shape, or a box?
2. Close-ups: `focus: { from, to }` around the part you doubt (a window row, a roof edge, an entrance). Use a small box so the textures are readable.
3. Interiors: set `clipY` just under the roof or ceiling, and use an `iso_*` view to look into the rooms. Use `view: "top"` with `clipY` for a floor plan.
4. Read the text next to the image. It lists block ids that did not resolve (they show as a magenta/black checker): fix the typo or the missing property instead of exporting them.
5. Compare what you see with what you intended (floor height `H`, rhythm, accent lines). Fix with `fillBox`/`setBlocks`/`replaceInRegion`, then look again at the same view so the two images can be compared.

If the image is plain colors instead of textures, the texture download is not finished or failed (the text says which); the shapes are still right. `renderView` needs Microsoft Edge or Google Chrome on the machine.

## Raid Maps

For a raid map (a shooter mod's arena, exported as 48x48 `.nbt` tiles plus `map.json`), the project coordinates are the map coordinates: the map covers `(0,0,0)` to `size-1`. With 16 underground layers the ground surface is about y=16, and feet stand one above it. `pos` of every marker is **the cell the feet occupy** (for `loot`: the cell the crate goes in).

**Order:** `createProject` -> `setMapSettings` -> terrain (16 layers below, then the ground) -> perimeter wall -> roads -> buildings from templates -> `decayRegion` -> markers -> `renderView` -> `validateRaidMap` -> fix -> `exportRaidMap`.

- Prefer a size that is a multiple of 48 (384, 432, 480): edge tiles are then 48x48 too.
- Keep `loot` cells as air (the mod places the crate); a barrel is allowed. `saveTemplate`/`placeTemplate` carry `loot` and `enemy_spawn` markers with the building, rotated and flipped. `copyRegion`/`stackRegion` do not copy markers.
- Use only blocks that exist in the target version (default 1.21.1): no copper bars, no newer wood types. If `validateRaidMap`/`exportRaidMap` warns about an id or property, replace it.
- Walking rules the validation uses: steps of at most 1 block up or down (no jumping down from roofs, so a rooftop route that needs a drop counts as unreachable), no diagonal moves, wooden doors and open gates are passable, iron doors, fences, walls and closed gates are not. A slab between two steps makes a 2-block climb passable. Enemy corridors should be at least 2 wide (patrol routes are checked and warned about).
- Terrain rules the validation does not check, so check them yourself with `renderView`: cover at both height 1 and height 2, cover about every 20 blocks, 1-high 1-deep obstacles to climb over, 1-high windows, wooden doors or open doorways only, no trapdoors blocking a path, light sources indoors, and a closed perimeter.
- Counts that the validation warns about: at least 6 player spawns, 60+ blocks apart, and at least 4 extracts. A tier 3 crate should have a tier 3 enemy spawn within 32 blocks.
- `validateRaidMap` returns the first 20 errors and warnings; the full list is in `validation.json` after `exportRaidMap`. When a route is unreachable the message names the nearest cell that was reached, which is where the path breaks. Problems never stop the export, so read the result before handing the files over.

## Checklist

- [ ] Silhouette decided before any material
- [ ] Floor height `H` chosen; floors, bands and windows all derived from it
- [ ] Palette is primary + weathering + one non-random accent
- [ ] Visible spans computed before placing openings
- [ ] Carve order written down before building
- [ ] Looked at the build with `renderView` (overview from two corners, close-ups of the doubtful parts) after each stage, and no id is drawn as a magenta/black checker
- [ ] `getBuildInfo` bounding box matches the size budget and shows no isolated pane/bar warning (or each one is intended)
- [ ] `exportSchematic` run and the output file confirmed on disk
- [ ] Raid map: `validateRaidMap` shows no errors (or each is understood) and `exportRaidMap` was run

## Reference

Copy-ready palettes, the spiral staircase formula, conical roof taper tables, the two-call cornice trick, crenellation patterns, the alcove trick, and the visible-span formula live in `references/recipes.md`.
