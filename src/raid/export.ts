import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { BuildProject } from '../core/build-project.js';
import type { Marker, MapSettings } from '../core/markers.js';
import type { BlockState } from '../core/types.js';
import { DATA_VERSIONS } from '../schematic/data-version.js';
import { tileLayout, writeStructureTile } from '../schematic/structure-writer.js';
import { checkCompat, type BlockCatalog } from './compat.js';
import { encodePng } from './png.js';
import { LEGEND_LINES, renderMapPreview } from './preview-png.js';
import { TILE_SIZE, validateRaidMap, type ValidationReport } from './validate.js';

export interface ExportOptions {
  outputDir: string;
  /** Block catalog of the target version; null when it could not be obtained (check 12 then warns). */
  catalog: BlockCatalog | null;
  colorOf: (block: BlockState) => [number, number, number];
}

const TILE_FILE = /^tile_\d+_\d+\.nbt$/;

function mapJson(map: MapSettings, markers: readonly Marker[]): string {
  const of = <K extends Marker['kind']>(kind: K) => markers.filter((m): m is Extract<Marker, { kind: K }> => m.kind === kind);
  const json = {
    id: map.id,
    name: map.name,
    size: map.size,
    tile_size: TILE_SIZE,
    player_spawns: of('player_spawn').map((m) => ({ pos: m.pos, facing: m.facing })),
    extracts: of('extract').map((m) => ({ id: m.id, pos: m.pos, radius: m.radius })),
    loot: of('loot').map((m) => ({ pos: m.pos, type: m.type, tier: m.tier })),
    enemy_spawns: of('enemy_spawn').map((m) => ({ pos: m.pos, squad_size: m.squadSize, tier: m.tier })),
    patrol_routes: of('patrol_route').map((m) => ({ id: m.id, points: m.points }))
  };
  return JSON.stringify(json, null, 2) + '\n';
}

/**
 * Writes tiles, map.json, preview.png, preview-legend.txt and validation.json.
 * Problems found by the validation never stop the export; they are in the report.
 */
export function exportRaidMap(project: BuildProject, opts: ExportOptions): { dir: string; report: ValidationReport } {
  const map = project.mapSettings;
  if (!map) throw new Error('This project has no map settings. Call setMapSettings first.');
  const markers: Marker[] = project.getMarkers().map(({ markerId: _markerId, ...marker }) => marker as Marker);
  const dir = resolve(opts.outputDir);
  const tilesDir = join(dir, 'tiles');
  mkdirSync(tilesDir, { recursive: true });

  // Only old tiles go; anything else in the folder is left alone.
  for (const name of readdirSync(tilesDir)) {
    if (TILE_FILE.test(name)) rmSync(join(tilesDir, name), { force: true });
  }

  // One tile at a time, so the whole map's NBT is never in memory.
  const layout = tileLayout(map.size, TILE_SIZE);
  const expected = layout.map((t) => `tile_${t.tx}_${t.tz}.nbt`);
  const written: string[] = [];
  const dataVersion = DATA_VERSIONS[map.targetVersion];
  for (const tile of layout) {
    const name = `tile_${tile.tx}_${tile.tz}.nbt`;
    try {
      writeFileSync(join(tilesDir, name), writeStructureTile(project, tile, { dataVersion, includeAir: map.includeAir }));
      written.push(name);
    } catch {
      // Reported by check 6.
    }
  }

  let previewWritten = false;
  try {
    const image = renderMapPreview(project, map, markers, { colorOf: opts.colorOf });
    writeFileSync(join(dir, 'preview.png'), encodePng(image.width, image.height, image.rgba));
    previewWritten = true;
  } catch {
    // Reported by check 7.
  }
  try {
    writeFileSync(join(dir, 'preview-legend.txt'), LEGEND_LINES.join('\n') + '\n');
  } catch {
    // The legend is a convenience.
  }
  try {
    writeFileSync(join(dir, 'map.json'), mapJson(map, markers));
  } catch {
    // Nothing sensible to do; the caller sees the missing file.
  }

  const report = validateRaidMap(project, map, markers, {
    tiles: { expected, written },
    previewWritten,
    compat: checkCompat(project, opts.catalog)
  });
  try {
    writeFileSync(join(dir, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  } catch {
    // Same as above.
  }
  return { dir, report };
}
