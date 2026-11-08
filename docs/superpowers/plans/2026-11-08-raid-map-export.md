# レイドマップの書き出し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マップの設定とマーカーを持たせ、48×48 の `.nbt` タイル、`map.json`、`preview.png`、検証結果を 1 回の呼び出しで書き出せるようにする。

**Architecture:** マップの設定とマーカーは `BuildProject` が持ち、`project-store.ts` が `project.json` の `map` フィールドと `markers.json` に保存する。`.nbt` は `src/schematic/structure-writer.ts`、検証まわりは新しい `src/raid/` に置く。歩行グリッドと検証は純粋な関数にして、ファイルの書き出し（`export.ts`）から呼ぶ。

**Tech Stack:** TypeScript, `@enginehub/nbt-ts`, Node `zlib`, vitest

**Spec:** `docs/superpowers/specs/2026-11-08-raid-map-export-design.md`

**Execution:**
- マーカーの型（`src/core/markers.ts`）はメインセッションが作成済み（`5c7f2ef`）。
- Task 1〜3：Sonnet のサブエージェント 1 体が、別の worktree で通しで担当する。
- Task 4：メインセッション（Opus）が、並行して担当する。
- Task 5〜7：Task 1〜4 を合わせたあと、Sonnet のサブエージェント 1 体が通しで担当する。

## Global Constraints

- マップの座標は、プロジェクトの座標そのまま。範囲は `(0,0,0)`〜`(size-1)`。
- `targetVersion` は `'1.21.1' | '1.21.11'`（既定 `'1.21.1'`）。DataVersion は 1.21.1 → 3955、1.21.11 → 4671。`includeAir` の既定は `true`。
- `map.json` は spec §7 の例と同じキー、同じ順序、座標は配列で書く。
- タイル名は `tile_<tx>_<tz>.nbt`（タイルの番号）。タイル数は `ceil(size.x/48) × ceil(size.z/48)`。
- 検証で問題が見つかっても、ファイルは書き出す。
- 新しい依存ライブラリは追加しない。
- ファイルは 1 つずつ指定して `git add` する（`git add -A` や `git add .` は使わない）。

## Review Focus

- 段差の判定：ハーフブロックを挟んだ 2 段の上りは行ける、ハーフブロックなしの 2 段は行けない → Task 4 のテスト。
- 範囲の外のブロックとマーカー：書き出しから落ち、警告とエラーになること → Task 4（検証）と Task 5（書き出し）のテスト。
- `includeAir: false` のときに、空気と未設定のマスが `blocks` に入らないこと → Task 2 のテスト。
- 既存のプロジェクト（`map` も `markers.json` もないもの）が、これまでどおり読み込めること → Task 1 のテスト。
- テンプレートを 90 度回して置いたときに、箱のマーカーも正しい位置に来ること → Task 1 のテスト。

---

### Task 1: マップの設定とマーカーの保持、保存、ツール

**Files:**
- Modify: `src/core/build-project.ts`、`src/core/project-store.ts`、`src/core/templates.ts`、`src/core/template-store.ts`
- Create: `src/core/marker-ops.ts`、`src/tools/raid-tools.ts`
- Modify: `src/tools/registry.ts`
- Test: `test/core/marker-ops.test.ts`、`test/core/project-store.test.ts`（追記）、`test/core/templates.test.ts`（追記）、`test/tools/raid-tools.test.ts`

**Interfaces:**
- Consumes: `src/core/markers.ts`（`MapSettings`、`Marker`、`StoredMarker`、`MarkerKind`）
- Produces:
  - `BuildProject`: `mapSettings: MapSettings | null`（読み書きできるプロパティ）、`getMarkers(): readonly StoredMarker[]`、`addMarkers(markers: Marker[]): string[]`（内部 ID を返す。`extract.id` と `patrol_route.id` の重複はエラー。1 件でも不正なら 1 件も追加しない）、`removeMarkers(ids: string[]): number`、`markersDirty: boolean`（保存用）
  - `project-store.ts`: `project.json` の任意フィールド `map` と、`markers.json`（`{ formatVersion: 1, nextId: number, markers: StoredMarker[] }`）を読み書きする。マーカーが変わったときだけ `markers.json` を書く
  - `marker-ops.ts`: `transformMarker(m: Marker, anchorOffset: Pos → world, t: Transform)`（テンプレート用。`loot` と `enemy_spawn` の `pos` を変換する）
  - テンプレート：`saveTemplate` が範囲内の `loot` と `enemy_spawn` を `markers`（基準点からの相対座標）として保存し、`placeTemplate` がそれを変換して追加する。`RegionResult` に `markers?: number` を足して、レスポンスに件数を出す
  - ツール：`setMapSettings { id, name, size, targetVersion?, includeAir? }`、`addMarkers { markers }`（`kind` で区別する zod の discriminated union。`squadSize` は `[min, max]` で `1 ≤ min ≤ max`、`tier` は 1〜3、`radius` の既定は 4、`patrol_route.points` は 2 点以上）、`listMarkers { kind? }`、`removeMarkers { ids }`。4 つとも `mutating`（`listMarkers` は除く）、`addMarkers` と `removeMarkers` は `batchable`

- [ ] **Step 1: 失敗するテストを書く** — マーカーの追加、一覧、削除、ID の重複、不正な入力で 1 件も追加されないこと、保存して読み直すと同じ、`map` も `markers.json` もない古いプロジェクトが読めること、テンプレートを 90 度回して置くと箱のマーカーが回転した位置に来ること、`copyRegion` ではマーカーが増えないこと
- [ ] **Step 2: 失敗を確認する** → FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 全テスト** — `pnpm test` → PASS
- [ ] **Step 5: コミット** — `feat: store raid map settings and markers, including markers inside templates`

---

### Task 2: `.nbt`（StructureTemplate）のタイル書き出し

**Files:**
- Create: `src/schematic/structure-writer.ts`
- Modify: `src/schematic/data-version.ts`（`DATA_VERSIONS: Record<TargetVersion, number>` を追加。既存の `DATA_VERSION` は残す）
- Test: `test/schematic/structure-writer.test.ts`

**Interfaces:**
- Produces:
  - `export interface TileSpec { tx: number; tz: number; x0: number; z0: number; sx: number; sy: number; sz: number }`
  - `export function tileLayout(size: Pos, tileSize = 48): TileSpec[]`
  - `export function writeStructureTile(project: BuildProject, tile: TileSpec, opts: { dataVersion: number; includeAir: boolean }): Buffer`（gzip した NBT。座標はタイル内の相対座標。接続の解決を適用する。`resolveConnectionAt` を使う）
- [ ] **Step 1: 失敗するテストを書く** — `nbt-ts` で decode して、`DataVersion`、`size`、`palette`（`Name` と `Properties`）、`blocks` の `pos` と `state`、`entities` が空のリストであること。`includeAir: true` では未設定のマスも `minecraft:air` になり、`blocks` の数が `sx*sy*sz` になること。`false` では空気も未設定も入らないこと。端のタイルの大きさ（`size` が 100 のとき、`tileLayout` の最後のタイルの `sx` が 4）。フェンスの接続が解決されていること
- [ ] **Step 2: 失敗を確認する** → FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する** → PASS
- [ ] **Step 5: コミット** — `feat: write 48x48 StructureTemplate .nbt tiles`

---

### Task 3: 1.21.1 との互換性チェック

**Files:**
- Create: `src/raid/compat.ts`
- Test: `test/raid/compat.test.ts`

**Interfaces:**
- Consumes: `AssetStore`（`src/preview/assets/asset-store.ts`）
- Produces:
  - `export interface BlockCatalog { has(id: string): boolean; propertyNames(id: string): ReadonlySet<string> }`
  - `export function catalogFromAssets(assets: AssetStore): BlockCatalog`（`blockstates/*.json` の一覧と、`variants` のキーと `multipart` の `when` のキーからプロパティ名を集める）
  - `export function checkCompat(project: BuildProject, catalog: BlockCatalog | null): { message: string }[]`（ID ごとにまとめて、個数を添える。`catalog` が `null` なら「確かめられなかった」を 1 件返す）
- [ ] **Step 1: 失敗するテストを書く** — 偽の `AssetStore`（`readJson` とファイル一覧を差し替えたもの）で、存在しない ID、知らないプロパティ名、問題なし、`null` の 4 通り
- [ ] **Step 2〜4: 失敗の確認、実装、成功の確認**
- [ ] **Step 5: コミット** — `feat: check block ids and property names against the target version`

---

### Task 4: 歩行グリッドと検証（メインセッションが担当）

**Files:**
- Create: `src/raid/walk-grid.ts`、`src/raid/validate.ts`
- Test: `test/raid/walk-grid.test.ts`、`test/raid/validate.test.ts`

**Interfaces:**
- Consumes: `BuildProject`、`src/core/markers.ts`
- Produces:

```ts
// walk-grid.ts
export interface WalkGrid {
  size: Pos;
  standable(x: number, y: number, z: number): boolean;
  level(x: number, y: number, z: number): number; // 足の高さ L（立てないマスは NaN）
  wide(x: number, y: number, z: number): boolean; // 2x2 の幅 2 判定
}
export function buildWalkGrid(project: BuildProject, size: Pos): WalkGrid;
export interface ReachResult { reached: (p: Pos) => boolean; nearest(target: Pos): { pos: Pos; distance: number } | null }
export function explore(grid: WalkGrid, start: Pos, opts?: { wideOnly?: boolean }): ReachResult;

// validate.ts
export interface Issue { check: number; message: string; at?: Pos }
export interface ValidationReport { ok: boolean; errors: Issue[]; warnings: Issue[]; stats: { tiles: number; blocks: number; markers: Record<string, number>; durationMs: number } }
export interface ValidationExtras {
  tiles?: { expected: string[]; written: string[] };     // 検証 6
  previewWritten?: boolean;                              // 検証 7
  compat?: { message: string }[];                        // 検証 12
}
export function validateRaidMap(project: BuildProject, extras?: ValidationExtras): ValidationReport;
export function formatReport(report: ValidationReport): string; // OK / N errors, M warnings、各最大 20 件
```

- [ ] **Step 1: 失敗するテストを書く**（spec §11 の歩行グリッドの全ケースと、検証 1〜5、8〜11、13 のそれぞれの合格・不合格）
- [ ] **Step 2: 失敗を確認する** → FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確認する** → PASS
- [ ] **Step 5: コミット** — `feat: add walk grid and raid map validation`

---

### Task 5: `preview.png` と書き出しのツール

**Files:**
- Create: `src/raid/png.ts`、`src/raid/preview-png.ts`、`src/raid/export.ts`
- Modify: `src/tools/raid-tools.ts`、`src/tools/registry.ts`
- Test: `test/raid/png.test.ts`、`test/raid/preview-png.test.ts`、`test/raid/export.test.ts`

**Interfaces:**
- Consumes: Task 1〜4
- Produces:
  - `export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer`
  - `export function renderMapPreview(project: BuildProject, opts: { colorOf: (block: BlockState) => [number, number, number] }): { width: number; height: number; rgba: Uint8Array }`（spec §6）
  - `export function exportRaidMap(project: BuildProject, opts: { outputDir: string; catalog: BlockCatalog | null; colorOf: ... }): { dir: string; report: ValidationReport }`（spec §7。古い `tiles/tile_*.nbt` だけを消してから書く）
  - ツール：`validateRaidMap {}`、`exportRaidMap { outputDir? }`（既定 `./output/maps/<id>/`）。どちらも、マップの設定がなければ `setMapSettings` を案内するエラー。`colorOf` は、アセットがあればテクスチャの平均色、なければ `colorFor`。互換性チェック用の `AssetStore` は `targetVersion` ごとに `PreviewServerState` などで共有する（方法は任せる）
- [ ] **Step 1: 失敗するテストを書く** — PNG のシグネチャと CRC、IHDR の大きさ、マーカーの色のピクセル位置、書き出し先のファイル一覧（`map.json`、`tiles/…`、`preview.png`、`preview-legend.txt`、`validation.json`）、`map.json` の形が spec の例と一致、古いタイルが消えること、エラーがあってもファイルが書かれること
- [ ] **Step 2〜4: 失敗の確認、実装、成功の確認**
- [ ] **Step 5: コミット** — `feat: export raid maps with tiles, map.json, preview.png and validation`

---

### Task 6: 3D プレビューのマーカー表示

**Files:**
- Modify: `src/preview/server.ts`、`src/preview/client/viewer.ts`（ほか必要なもの）、`src/preview/render-view.ts`（`markers=0`）
- Test: `test/preview/server.test.ts`（`/api/markers`）

- [ ] **Step 1: `/api/markers` のテストを書く**
- [ ] **Step 2: 実装する**（spec §8）
- [ ] **Step 3: `renderView` で、マーカーを置いた小さなマップを撮って、スクリーンショットを scratchpad に保存して確認する**
- [ ] **Step 4: 全テスト** → PASS
- [ ] **Step 5: コミット** — `feat: show raid map markers in the 3D preview`

---

### Task 7: スキル、ドキュメント、性能テスト

**Files:**
- Modify: `.claude/skills/building-minecraft-schematics/SKILL.md`（spec §9）、`CLAUDE.md`、`README.md`
- Create: `test/perf/raid-export.test.ts`（500×80×500 の疑似的な街で、検証 30 秒以内、書き出し全体 60 秒以内）
- [ ] **Step 1: 性能テストを書いて実行する** — `pnpm test:perf`
- [ ] **Step 2: ドキュメントを更新する**
- [ ] **Step 3: `pnpm test` と `pnpm build` → PASS**
- [ ] **Step 4: コミット** — `docs: document raid map export and add its performance test`
