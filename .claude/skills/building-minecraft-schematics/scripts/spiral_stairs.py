#!/usr/bin/env python3
"""Generate a mc-schema-mcp `setBlocks` payload for a 3x3 spiral staircase.

The staircase wraps a solid 1x1 newel column: 8 steps per revolution, so a
revolution rises exactly 8 blocks. Pair it with a floor height of 8 and each
floor becomes one clean turn.

Requirements at build time:
  * The 3x3 shaft must be carved to air first (it usually crosses nearby walls).
  * The newel column must be solid from --from-y to --to-y minus one.
  * Inside a hollow tower the interior radius must be at least 2 (cylinder r=3).

Example
-------
    ./spiral_stairs.py --center 12 12 --from-y 1 --to-y 44 --newel
"""

import argparse
import json

# Clockwise from above, +x = east, +z = south: the eight cells surrounding the
# newel. `facing` is derived from the ring order rather than hardcoded, because
# Minecraft stairs must face the direction of travel (the direction you ascend).
RING_CW = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]

STEP_DIR = {(0, 1): "south", (0, -1): "north", (1, 0): "east", (-1, 0): "west"}


def ring(direction):
    """Return [(offset, facing)] for one revolution."""
    cells = RING_CW if direction == "cw" else list(reversed(RING_CW))
    out = []
    for i, (dx, dz) in enumerate(cells):
        nx, nz = cells[(i + 1) % len(cells)]
        facing = STEP_DIR.get((nx - dx, nz - dz))
        if facing is None:  # unreachable for the 8-cell ring; guards future edits
            raise ValueError(f"non-axial step between {cells[i]} and {(nx, nz)}")
        out.append(((dx, dz), facing))
    return out


def build(cx, cz, y0, y1, block, direction, newel_block):
    cells = ring(direction)
    out = []
    if newel_block:
        for y in range(y0, y1):
            out.append({"pos": {"x": cx, "y": y, "z": cz},
                        "block": {"id": newel_block}})
    for y in range(y0, y1 + 1):
        (dx, dz), facing = cells[(y - y0) % 8]
        out.append({
            "pos": {"x": cx + dx, "y": y, "z": cz + dz},
            "block": {
                "id": block,
                "properties": {"facing": facing, "half": "bottom",
                               "shape": "straight", "waterlogged": "false"},
            },
        })
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--center", nargs=2, type=int, required=True, metavar=("X", "Z"),
                   help="newel column coordinates")
    p.add_argument("--from-y", type=int, required=True, help="first step Y (inclusive)")
    p.add_argument("--to-y", type=int, required=True, help="last step Y (inclusive)")
    p.add_argument("--block", default="minecraft:stone_brick_stairs",
                   help="stairs block id (default: %(default)s)")
    p.add_argument("--direction", choices=("cw", "ccw"), default="cw",
                   help="rotation seen from above (default: %(default)s)")
    p.add_argument("--newel", action="store_true",
                   help="also emit the newel column")
    p.add_argument("--newel-block", default="minecraft:polished_deepslate",
                   help="newel block id (default: %(default)s)")
    p.add_argument("--pretty", action="store_true", help="indent the JSON")
    a = p.parse_args()

    if a.to_y < a.from_y:
        p.error("--to-y must be >= --from-y")

    blocks = build(a.center[0], a.center[1], a.from_y, a.to_y, a.block,
                   a.direction, a.newel_block if a.newel else None)
    if a.pretty:
        print(json.dumps(blocks, indent=2))
    else:
        print(json.dumps(blocks, separators=(",", ":")))


if __name__ == "__main__":
    main()
