# 編集ツール・テンプレート・一括実行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 範囲の複製、積み重ね、置き換え、消去、崩し、回転と反転、テンプレートの保存と配置、一括実行、孤立したガラス板の警告を追加する。

**Architecture:** 純粋な変換ロジックを `src/core/` の小さなモジュール（`random`、`block-match`、`transform`、`region-ops`、`template-store`、`templates`）に分ける。MCP ツールの入口は `src/tools/registry.ts` の 1 つの表にまとめ、`server.ts` の登録と `batch` の両方がその表を使う。接続判定の修正と警告は `connections.ts` に置く。

**Tech Stack:** TypeScript (NodeNext, strict), zod 3, vitest, Node 標準の `fs` / `zlib`

**Spec:** `docs/superpowers/specs/2026-11-08-edit-tools-templates-design.md`（第 1 段階の `2026-11-08-chunked-storage-persistence-design.md` を前提にする）

**Execution:** Sonnet のサブエージェント 1 体が Task 1〜6 を順に通しで実装する。完了後、メインセッションが全体をレビューする。

## Global Constraints

- 範囲の `from` / `to` は順不同で、両端を含む。1 回の操作で扱える範囲は 32,000,000 セルまで。超えたらエラーにする。
- 未設定のセルは、コピー先やテンプレートの配置先を変えない。`minecraft:air` は上書きする。
- ランダムを使う新規ツールは、任意の `seed`（整数）を受け取る。セルは y → z → x の昇順に走査して乱数を引く。同じ `seed` と同じ入力なら、同じ結果になる。
- 回転は Y 軸周りに 0/90/180/270 度で、真上から見て時計回り（N→E→S→W）。`flip` は `'x' | 'z'`。両方を指定したら、反転を先、回転を後に適用する。
- `setBlock` に渡した `BlockState` オブジェクトを、後から書き換えて再利用しない（第 1 段階の参照キャッシュのため）。
- 新しい変更系ツールは、すべて第 1 段階の `withSave` で包む。`batch` は全体を 1 回だけ包む。
- 新しいツールのレスポンスには、変更したセル数と、書き込み先のバウンディングボックス（絶対座標）を含める。
- テンプレートの保存先は `MC_SCHEMA_TEMPLATE_DIR`（既定は `./templates`）。名前の規則と、Windows で安全な名前かどうかの検証は、プロジェクト名と同じにする（`server.ts` の `projectNameSchema`）。
- コードとコミットメッセージは英語。`CLAUDE.md` は日本語で書く。スキルは既存の英語の文体に合わせる。

## Review Focus

- 回転の後で、階段の向きと位置が両方正しいか。90 度回したコピーの中で、北向きの階段が東向きになって、正しいセルに置かれること → Task 3 のテスト。
- コピー元とコピー先の範囲が重なる場合。`copyRegion` で 1 マスずらしても、コピー元が書き換え途中の状態で読まれないこと → Task 3 のテスト。
- テンプレートの基準点（`anchor`）と回転の組み合わせ。90 度回したとき、基準点が `at` にぴったり来ること → Task 4 のテスト。
- `batch` の途中のエラー。それ以前の操作はメモリとディスクの両方に残り、レスポンスに適用済みの件数が出ること → Task 5 のテスト。
- 円柱の外周に置いたガラス板で、斜めの位置だけが警告されること。ガラスブロックと隣り合ったガラス板は警告されないこと → Task 1 のテスト。

---

### Task 1: 接続判定の修正と孤立ブロックの警告

**Files:**
- Modify: `src/schematic/connections.ts`
- Modify: `src/tools/info-tools.ts`（`getBuildInfo` と `exportSchematic` に警告を付ける）
- Test: `test/schematic/connections.test.ts`、`test/tools/info-tools.test.ts`

**Interfaces:**
- Produces: `export function findIsolatedConnectables(project: BuildProject): Vec3[]`（座標順 y → z → x で並べる）
- Produces: `export function formatIsolatedWarning(positions: Vec3[]): string`（0 件なら `''`。最大 20 件まで列挙し、残りは `(+N more)` で示す。文面は spec §5 のとおり）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('connects panes to glass blocks and walls, and fences to glass blocks', () => {
  // pane at (0,0,0) with glass at east, cobblestone_wall at west → east:'true', west:'true'
  // oak_fence with glass at north → north:'true'
});
it('does not connect panes or fences to pumpkins, melons, leaves, shulker boxes or barriers', () => {});
it('connects walls to glass, panes and bars', () => {}); // cobblestone_wall + glass at east → east !== 'none'
it('does not connect wooden fences to nether brick fences', () => {});
it('treats copper bars like iron bars', () => {}); // minecraft:copper_bars and waxed_oxidized_copper_bars connect to a pane neighbor
it('flags only the diagonal panes of a cylinder shell', () => {
  // cylinder(project, {x:0,y:0,z:0}, 6, 1, {id:'minecraft:glass_pane'}, true)
  // every flagged position has no pane/solid neighbor in N/S/E/W; at least one flagged; positions with a horizontal neighbor are not flagged
});
it('does not flag fences or walls standing alone', () => {});
it('caps the warning at 20 positions', () => {
  expect(formatIsolatedWarning(Array.from({ length: 23 }, (_, i) => ({ x: i * 3, y: 0, z: 0 })))).toMatch(/^Warning: 23 isolated .*\(\+3 more\)/);
  expect(formatIsolatedWarning([])).toBe('');
});
```

`info-tools.test.ts`：ガラス板を 1 つだけ置いたプロジェクトでは、`getBuildInfo` と `exportSchematic` の文面に `Warning: 1 isolated` が含まれる。孤立がなければ、`Warning` を含まない。

- [ ] **Step 2: 失敗を確認する** — Run: `pnpm exec vitest run test/schematic/connections.test.ts test/tools/info-tools.test.ts` → FAIL
- [ ] **Step 3: 実装する** — `isPaneFamily` は `*_pane` と `*_bars`。接続の例外リストは `*_leaves`、`pumpkin`、`carved_pumpkin`、`jack_o_lantern`、`melon`、`*shulker_box`、`barrier`。鎖（`chain`、`iron_chain`、`*_chain`）は「完全なブロックではない」扱いにする。既存の壁テストで本家と食い違う期待値は、本家の挙動に合わせて更新し、コミットメッセージにその旨を書く。
- [ ] **Step 4: 通ることを確認する** — Run: `pnpm test` → PASS
- [ ] **Step 5: コミット** — `fix: align pane/fence/wall connections with vanilla and warn about isolated panes`

---

### Task 2: 乱数、ブロックの一致判定、回転と反転

**Files:**
- Create: `src/core/random.ts`、`src/core/block-match.ts`、`src/core/transform.ts`
- Test: `test/core/random.test.ts`、`test/core/block-match.test.ts`、`test/core/transform.test.ts`

**Interfaces:**
- `random.ts`:
  - `export type Rng = () => number`（[0, 1) を返す）
  - `export function createRng(seed?: number): Rng`（seed がなければ `Math.random` 由来のシードを使う。アルゴリズムは mulberry32 など、決定的なもの）
  - `export function pickFromPalette(value: BlockOrPalette, rng: Rng): BlockState`（`shapes.ts` の `resolveBlock` と同じ重み付き抽選。`shapes.ts` は変更しない）
- `block-match.ts`:
  - `export interface BlockMatcher { id: string; properties?: Record<string, string> }`
  - `export function normalizeId(id: string): string`（`minecraft:` がなければ補う）
  - `export function matchesAny(block: Readonly<BlockState>, matchers: BlockMatcher[]): boolean`（`*` のワイルドカードに対応）
  - `export type KeepProperties = 'auto' | boolean`
  - `export function applyReplacement(source: Readonly<BlockState>, replacement: BlockState, keep: KeepProperties): BlockState`（新しいオブジェクトを返す。`'auto'` の規則と、`wall_` の例外は spec §2 のとおり）
- `transform.ts`:
  - `export type Rotation = 0 | 90 | 180 | 270; export type Flip = 'x' | 'z'; export interface Transform { rotate?: Rotation; flip?: Flip }`
  - `export function transformOffset(offset: Vec3, t: Transform): Vec3`（原点を中心に変換する。flip 'x' は x → −x）
  - `export function transformBlockState(block: Readonly<BlockState>, t: Transform): BlockState`（spec §1 の表）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// random
expect(Array.from({ length: 5 }, createRng(42))).toEqual(Array.from({ length: 5 }, createRng(42)));
// block-match
expect(matchesAny({ id: 'minecraft:oak_stairs', properties: { facing: 'north' } }, [{ id: '*_stairs' }])).toBe(true);
expect(matchesAny({ id: 'minecraft:oak_stairs', properties: { facing: 'north' } }, [{ id: 'oak_stairs', properties: { facing: 'south' } }])).toBe(false);
expect(applyReplacement({ id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'top' } }, { id: 'minecraft:spruce_stairs' }, 'auto'))
  .toEqual({ id: 'minecraft:spruce_stairs', properties: { facing: 'east', half: 'top' } });
expect(applyReplacement({ id: 'minecraft:oak_stairs', properties: { facing: 'east' } }, { id: 'minecraft:stone_bricks' }, 'auto')).toEqual({ id: 'minecraft:stone_bricks' });
expect(applyReplacement({ id: 'minecraft:oak_wall_sign', properties: { facing: 'east' } }, { id: 'minecraft:oak_sign' }, 'auto')).toEqual({ id: 'minecraft:oak_sign' });
// transform: facing
const f = (facing: string, t: Transform) => transformBlockState({ id: 'minecraft:oak_stairs', properties: { facing } }, t).properties!.facing;
expect(f('north', { rotate: 90 })).toBe('east');
expect(f('west', { rotate: 270 })).toBe('south');
expect(f('east', { flip: 'x' })).toBe('west');
expect(f('north', { flip: 'x' })).toBe('north');
expect(f('north', { flip: 'z', rotate: 90 })).toBe('west'); // flip first: north→south, then rotate 90: south→west
// rotation (signs)
const r = (v: number, t: Transform) => transformBlockState({ id: 'minecraft:oak_sign', properties: { rotation: String(v) } }, t).properties!.rotation;
expect(r(0, { rotate: 90 })).toBe('4'); expect(r(14, { rotate: 90 })).toBe('2');
expect(r(0, { flip: 'z' })).toBe('8'); expect(r(4, { flip: 'z' })).toBe('4');
expect(r(4, { flip: 'x' })).toBe('12'); expect(r(0, { flip: 'x' })).toBe('0');
// axis, stairs shape, hinge, chest type, side_chain, rail shape, N/E/S/W remap
expect(transformBlockState({ id: 'minecraft:oak_log', properties: { axis: 'x' } }, { rotate: 90 }).properties!.axis).toBe('z');
expect(transformBlockState({ id: 'minecraft:oak_stairs', properties: { facing: 'north', shape: 'inner_left' } }, { flip: 'x' }).properties!.shape).toBe('inner_right');
expect(transformBlockState({ id: 'minecraft:oak_door', properties: { hinge: 'left' } }, { flip: 'z' }).properties!.hinge).toBe('right');
expect(transformBlockState({ id: 'minecraft:rail', properties: { shape: 'north_east' } }, { rotate: 90 }).properties!.shape).toBe('south_east');
expect(transformBlockState({ id: 'minecraft:rail', properties: { shape: 'ascending_north' } }, { flip: 'z' }).properties!.shape).toBe('ascending_south');
expect(transformBlockState({ id: 'minecraft:vine', properties: { north: 'true', east: 'false', south: 'false', west: 'false' } }, { rotate: 90 }).properties)
  .toMatchObject({ east: 'true', north: 'false' });
// round trips
for (const rot of [0, 90, 180, 270] as const) expect(transformOffset(transformOffset({ x: 3, y: 1, z: -2 }, { rotate: rot }), { rotate: ((360 - rot) % 360) as Rotation })).toEqual({ x: 3, y: 1, z: -2 });
expect(transformOffset({ x: 3, y: 1, z: -2 }, { rotate: 90 })).toEqual({ x: 2, y: 1, z: 3 }); // clockwise from above: +x(east)→+z(south), −z(north)→+x(east)
```

レールの `shape` は、方向名を変換したあと、本家に存在する並び（`north_east`、`north_west`、`south_east`、`south_west`、`north_south`、`east_west`）に正規化する。

- [ ] **Step 2: 失敗を確認する** — Run: `pnpm exec vitest run test/core/random.test.ts test/core/block-match.test.ts test/core/transform.test.ts` → FAIL
- [ ] **Step 3: 3 つのモジュールを実装する**
- [ ] **Step 4: 通ることを確認する** — 同じコマンド → PASS
- [ ] **Step 5: コミット** — `feat: add seeded rng, block matching, and rotation/flip transforms`

---

### Task 3: 範囲の操作

**Files:**
- Create: `src/core/region-ops.ts`
- Test: `test/core/region-ops.test.ts`

**Interfaces:**
- Consumes: Task 2 のすべて
- Produces（どの関数も `RegionResult` を返す）:
  - `export interface RegionResult { changed: number; bounds: BoundingBox | null; rubble?: number }`
  - `export const MAX_REGION_CELLS = 32_000_000`
  - `export function copyRegion(p: BuildProject, from: Vec3, to: Vec3, dest: Vec3, t?: Transform): RegionResult` — 変換後の範囲の最小の角を `dest` に合わせる
  - `export type StackDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down'`
  - `export function stackRegion(p: BuildProject, from: Vec3, to: Vec3, direction: StackDirection, count: number, gap?: number): RegionResult` — `count` は 1〜256
  - `export function replaceInRegion(p: BuildProject, from: Vec3, to: Vec3, match: BlockMatcher[], replacement: BlockOrPalette, keep?: KeepProperties, seed?: number): RegionResult`
  - `export function clearRegion(p: BuildProject, from: Vec3, to: Vec3, mode?: 'unset' | 'air'): RegionResult`
  - `export interface DecayOptions { topBias?: boolean; protect?: BlockMatcher[]; rubble?: boolean; rubbleChance?: number; rubbleBlocks?: BlockOrPalette; seed?: number }`
  - `export function decayRegion(p: BuildProject, from: Vec3, to: Vec3, intensity: number, options?: DecayOptions): RegionResult`（削除数を `changed`、瓦礫の数を `rubble` に入れる）
  - `bounds` は、書き込み先の範囲（`copyRegion` と `stackRegion` は書き込んだ範囲全体、それ以外は対象の範囲）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('copies with rotation, moving and turning stairs together', () => {
  // source (0,0,0)..(2,0,0): stone at x=0, oak_stairs facing north at x=2
  // copyRegion(p, {0,0,0}, {2,0,0}, {10,0,10}, { rotate: 90 }) → region becomes 1 wide in x, 3 long in z
  // expect stone at (10,0,10), stairs at (10,0,12) with facing 'east'; result.bounds = {min:{10,0,10}, max:{10,0,12}}
});
it('does not overwrite with unset cells but does with air', () => {});
it('handles overlapping source and destination', () => {
  // line of 5 distinct blocks x=0..4, copy to dest x=1 → x=1..5 equals the original 0..4 sequence
});
it('stacks with and without gap in all six directions', () => {
  // 2-long region stacked east count 3 gap 1 → copies start at x+3, x+6, x+9
});
it('replaces with wildcards, property filters, and keeps stair facing on auto', () => {});
it('replaces with a palette reproducibly for the same seed', () => {});
it('clears to unset or to air', () => {});
it('decays nothing at intensity 0 and everything unprotected at intensity 1 without top bias', () => {});
it('decays reproducibly for the same seed and always rests rubble on something', () => {
  // every rubble cell has a non-unset, non-air block directly below
});
it('rejects regions over 32,000,000 cells', () => {
  expect(() => clearRegion(p, { x: 0, y: 0, z: 0 }, { x: 999, y: 99, z: 999 })).toThrow(/32,000,000|32000000/);
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `pnpm exec vitest run test/core/region-ops.test.ts` → FAIL
- [ ] **Step 3: 実装する** — `copyRegion` と `stackRegion` は、先にコピー元を `(offset, BlockState)` の配列に読み取ってから書き込む。`decayRegion` は削除するセルをすべて決めて、削除し、それから瓦礫を置く（spec §2）。
- [ ] **Step 4: 通ることを確認する** — 同じコマンド → PASS
- [ ] **Step 5: コミット** — `feat: add copy, stack, replace, clear and decay region operations`

---

### Task 4: テンプレート

**Files:**
- Create: `src/core/template-store.ts`、`src/core/templates.ts`
- Modify: `.gitignore`（`templates/` を追加）
- Test: `test/core/templates.test.ts`（一時ディレクトリを使う）

**Interfaces:**
- Consumes: Task 2 と Task 3（`MAX_REGION_CELLS`、`RegionResult`、`applyReplacement`、`matchesAny`、`transformOffset`、`transformBlockState`）
- Produces:
  - `export const MAX_TEMPLATE_CELLS = 2_097_152`
  - `export interface TemplateInfo { name: string; description?: string; size: [number, number, number]; anchor: [number, number, number]; createdAt: string }`
  - `template-store.ts`:
    - `saveTemplateFile(root: string, data: TemplateData, overwrite: boolean): void`
    - `loadTemplateFile(root: string, name: string): TemplateData`
    - `listTemplateFiles(root: string): TemplateInfo[]`
    - `moveTemplateToTrash(root: string, name: string): string`
    - 名前の解決は、大文字と小文字を区別しない。`TemplateData` は `TemplateInfo` に `palette: (BlockState | null)[]` と `blocks: Uint16Array` を足したもの。ファイル形式は spec §3 のとおり
  - `templates.ts`:
    - `export function saveTemplate(root: string, p: BuildProject, name: string, from: Vec3, to: Vec3, opts?: { anchor?: Vec3; description?: string; overwrite?: boolean }): TemplateInfo` — `anchor` は絶対座標。省略時は底面の中心（x と z は中央を切り捨て、y は最小値）
    - `export interface PlacementReplace { match: BlockMatcher[]; replacement: BlockOrPalette; keepProperties?: KeepProperties }`
    - `export function placeTemplate(root: string, p: BuildProject, name: string, at: Vec3, opts?: { rotate?: Rotation; flip?: Flip; replace?: PlacementReplace[]; seed?: number }): RegionResult` — 置き換えを先に、変換を後に適用する。変換後の基準点が `at` に来るように置く

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('round-trips a template through disk', () => {});
it('places so the transformed anchor lands on `at`', () => {
  // template (0,0,0)..(4,2,2), anchor (2,0,2) (front-door spot), a marker block at (4,0,0)
  // placeTemplate at (100,10,100) rotate 90 → anchor offset (0,0,0) at (100,10,100);
  // marker offset from anchor (2,0,-2) rotated 90 → (2,0,2) → marker at (102,10,102)
});
it('applies replace before rotation', () => {
  // template stairs facing north; replace match {id:'oak_stairs', properties:{facing:'north'}} → spruce_stairs; rotate 90
  // → placed block is spruce_stairs facing east
});
it('rejects templates over 2,097,152 cells', () => {});
it('refuses to overwrite unless asked and treats names case-insensitively', () => {});
it('moves deleted templates to trash and hides them from the list', () => {});
it('does not overwrite destination cells from unset template cells', () => {});
```

- [ ] **Step 2: 失敗を確認する** — Run: `pnpm exec vitest run test/core/templates.test.ts` → FAIL
- [ ] **Step 3: 実装する** — 第 1 段階の `project-store.ts` のアトミックな書き込みと、ゴミ箱への移動の方式に揃える（共通化できるなら、小さなヘルパーに切り出してよい）。
- [ ] **Step 4: 通ることを確認する** — 同じコマンド → PASS
- [ ] **Step 5: コミット** — `feat: add reusable building templates with anchored, transformed placement`

---

### Task 5: ツールの表、新規ツールの登録、`batch`

**Files:**
- Create: `src/tools/registry.ts`、`src/tools/region-tools.ts`、`src/tools/template-tools.ts`、`src/tools/batch-tool.ts`
- Modify: `src/server.ts`（表を使った登録に置き換える。zod のファクトリ関数は `registry.ts` へ移す）、`src/index.ts`（テンプレートの保存先を渡す）
- Test: `test/tools/region-tools.test.ts`、`test/tools/template-tools.test.ts`、`test/tools/batch-tool.test.ts`、`test/server.test.ts`（追記）

**Interfaces:**
- Consumes: Task 3 と Task 4、第 1 段階の `withSave`
- Produces:
  - `export interface ToolContext { manager: ProjectManager; templateDir: string; previewState: PreviewServerState }`
  - `export interface ToolDef { name: string; description: string; inputShape: () => z.ZodRawShape; mutating: boolean; batchable: boolean; run: (ctx: ToolContext, args: any) => ToolTextResult | Promise<ToolTextResult> }`
  - `export function buildToolDefs(): ToolDef[]` — 既存の全ツールと新規ツール（`copyRegion`、`stackRegion`、`replaceInRegion`、`clearRegion`、`decayRegion`、`saveTemplate`、`listTemplates`、`deleteTemplate`、`placeTemplate`、`batch`）
  - `batchable: true` は spec §4 の 14 ツールだけにする。`mutating: true` のツールは、`server.ts` の登録時に `withSave` で包む
  - `createServer(options?: { dataDir?: string; templateDir?: string })`。`templateDir` の既定は `./templates`。`src/index.ts` は `process.env.MC_SCHEMA_TEMPLATE_DIR ?? './templates'` を渡す
  - 各ツールの引数名は spec §2〜§4 のとおり（`copyRegion { from, to, dest, rotate?, flip? }`、`stackRegion { from, to, direction, count, gap? }`、`replaceInRegion { from, to, match, replacement, keepProperties?, seed? }`、`clearRegion { from, to, mode? }`、`decayRegion { from, to, intensity, topBias?, protect?, rubble?, rubbleChance?, rubbleBlocks?, seed? }`、`saveTemplate { name, from, to, anchor?, description?, overwrite? }`、`listTemplates {}`、`deleteTemplate { name }`、`placeTemplate { name, at, rotate?, flip?, replace?, seed? }`、`batch { operations: { tool, args }[] }`）
  - `rotate` の zod スキーマは `z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// batch-tool.test.ts
it('validates every operation before running any', () => {
  // ops: [fillBox valid, fillBox with from missing] → isError, text mentions 'operation 2' and 'from'; project still empty
});
it('stops at the first runtime error and reports how many were applied', () => {
  // ops: [setBlock, placeTemplate of missing name, setBlock] → isError, text /1 of 3 operations? applied/; first block present, third absent
});
it('rejects non-batchable tools', () => {
  // ops: [{tool:'exportSchematic', args:{}}] and [{tool:'batch', ...}] → isError before running
});
it('saves once per batch', () => {
  // spy on manager.saveActive via createServer with a dataDir → called exactly once for a 3-op batch
});
it('truncates long success output', () => {
  // 60 setBlock ops → text contains first 20 lines, last 5 lines, and '(35 more)'
});
// server.test.ts
it('registers all new tools', () => {
  // listTools() names include copyRegion, stackRegion, replaceInRegion, clearRegion, decayRegion, saveTemplate, listTemplates, deleteTemplate, placeTemplate, batch
});
it('generates inline JSON schemas without $ref', () => {
  // JSON.stringify(listTools()) does not contain '"$ref"'
});
```

`region-tools.test.ts` と `template-tools.test.ts` は、各ハンドラのレスポンスに変更したセル数とバウンディングボックスが含まれることを、1 ツールにつき 1 件ずつ確認する。

- [ ] **Step 2: 失敗を確認する** — Run: `pnpm exec vitest run test/tools test/server.test.ts` → FAIL
- [ ] **Step 3: 実装する** — `batch` の各操作の `args` は、そのツールの `z.object(def.inputShape())` で `safeParse` する。結果の 1 行は、各ツールの結果文の 1 行目を使う。
- [ ] **Step 4: 全テストとビルドが通ることを確認する** — Run: `pnpm test && pnpm build` → PASS
- [ ] **Step 5: コミット** — `feat: register region, template and batch tools from a single tool table`

---

### Task 6: スキルと CLAUDE.md

**Files:**
- Modify: `.claude/skills/building-minecraft-schematics/SKILL.md`（spec §6 の 4 項目。description の frontmatter に、新しいツール名 `copyRegion`、`placeTemplate`、`batch`、`decayRegion` を加える）
- Modify: `CLAUDE.md`（アーキテクチャに新しいモジュール、ツールの表、テンプレートの保存先、`MC_SCHEMA_TEMPLATE_DIR` を追記。`connections.ts` の説明から「`BuildProject.voxels`」を消して、現状に合わせる）

- [ ] **Step 1: 追記する**
- [ ] **Step 2: `pnpm test` が PASS のままであることを確認する**
- [ ] **Step 3: コミット** — `docs: document edit tools, templates and batch in CLAUDE.md and the build skill`
