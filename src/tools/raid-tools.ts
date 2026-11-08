import type { MapSettings, Marker, MarkerKind, Pos, TargetVersion } from '../core/markers.js';
import type { ProjectManager } from '../core/project-manager.js';
import { textResult, type ToolTextResult } from './result.js';

const KIND_ORDER: MarkerKind[] = ['player_spawn', 'extract', 'loot', 'enemy_spawn', 'patrol_route'];

const tuple = (v: readonly number[]) => `(${v.join(', ')})`;

export function setMapSettingsHandler(
  manager: ProjectManager,
  args: { id: string; name: string; size: Pos; targetVersion?: TargetVersion; includeAir?: boolean }
): ToolTextResult {
  const settings: MapSettings = {
    id: args.id,
    name: args.name,
    size: args.size,
    targetVersion: args.targetVersion ?? '1.21.1',
    includeAir: args.includeAir ?? true
  };
  manager.getActive().mapSettings = settings;
  return textResult(
    `Map "${settings.id}" ("${settings.name}") set to ${settings.size.join('x')} for Minecraft ${settings.targetVersion}; ` +
      `air is ${settings.includeAir ? 'written' : 'skipped'} in the tiles. ` +
      `The map covers (0, 0, 0)..${tuple(settings.size.map((n) => n - 1))}.`
  );
}

export function addMarkersHandler(manager: ProjectManager, args: { markers: Marker[] }): ToolTextResult {
  const ids = manager.getActive().addMarkers(args.markers);
  return textResult(`Added ${ids.length} marker(s): ${ids.join(', ')}.`);
}

function describeMarker(m: Marker & { markerId: string }): string {
  switch (m.kind) {
    case 'player_spawn':
      return `${m.markerId}: ${tuple(m.pos)} facing ${m.facing}`;
    case 'extract':
      return `${m.markerId}: "${m.id}" ${tuple(m.pos)} radius ${m.radius}`;
    case 'loot':
      return `${m.markerId}: ${tuple(m.pos)} ${m.type} tier ${m.tier}`;
    case 'enemy_spawn':
      return `${m.markerId}: ${tuple(m.pos)} squad ${m.squadSize[0]}-${m.squadSize[1]} tier ${m.tier}`;
    case 'patrol_route':
      return `${m.markerId}: "${m.id}" ${m.points.map(tuple).join(' -> ')}`;
  }
}

export function listMarkersHandler(manager: ProjectManager, args: { kind?: MarkerKind }): ToolTextResult {
  const markers = manager.getActive().getMarkers().filter((m) => args.kind === undefined || m.kind === args.kind);
  if (markers.length === 0) return textResult('(no markers yet)');
  const sections: string[] = [];
  for (const kind of KIND_ORDER) {
    const ofKind = markers.filter((m) => m.kind === kind);
    if (ofKind.length === 0) continue;
    sections.push(`${kind} (${ofKind.length})\n${ofKind.map((m) => `  ${describeMarker(m)}`).join('\n')}`);
  }
  return textResult(sections.join('\n'));
}

export function removeMarkersHandler(manager: ProjectManager, args: { ids: string[] }): ToolTextResult {
  const project = manager.getActive();
  const existing = new Set(project.getMarkers().map((m) => m.markerId));
  const unknown = args.ids.filter((id) => !existing.has(id));
  const removed = project.removeMarkers(args.ids);
  return textResult(
    `Removed ${removed} marker(s).` + (unknown.length > 0 ? ` Not found: ${unknown.join(', ')}.` : '')
  );
}
