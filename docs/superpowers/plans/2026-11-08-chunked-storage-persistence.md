# チャンク型ボクセル保存と永続化 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `BuildProject` の中身を 16³ チャンクの `Uint16Array` に置き換え、プロジェクトをディスクへ自動保存し、再起動後に再開できるようにする。

**Architecture:** `BuildProject` がチャンクとパレットと dirty なチャンクの集合を持つ。新規の `project-store.ts` がディスクの読み書きだけを担当する。`ProjectManager` は `dataDir` を受け取った場合のみ永続化を行い、受け取らなければ従来どおりメモリ上だけで動く（既存テストはこのモードで通す）。変更系ツールの保存は、`server.ts` の 1 つのラッパー関数で行う。

**Tech Stack:** TypeScript (NodeNext, strict), Node 標準の `fs` / `zlib` / `path`, vitest, pnpm

**Spec:** `docs/superpowers/specs/2026-11-08-chunked-storage-persistence-design.md`

**Execution:** Sonnet のサブエージェント 1 体が Task 1〜4 を順に通しで実装する（タスクごとにエージェントを分けない）。完了後、メインセッションが全体をレビューする。

## Global Constraints

- チャンクは 16×16×16。値はパレット番号で、`0` は未設定を表す。チャンク内の並びは `index = (ly * 16 + lz) * 16 + lx`。
- パレットは追記のみで、番号 1 から割り当てる。最大 65,535 種類で、超えたら例外を投げる。
- `minecraft:air` は通常のブロックとして保存する（未設定とは別物）。
- 保存先：`MC_SCHEMA_DATA_DIR` があればそこ、なければ `./projects`。構成は `<root>/<name>/project.json` と `<root>/<name>/chunks/<cx>_<cy>_<cz>.bin`（gzip 圧縮した Uint16 リトルエンディアンの生バイト）。
- `project.json` = `{ formatVersion: 1, name, palette: (BlockState|null)[], createdAt, updatedAt }`。`palette[0]` は `null`。
- 書き込み順は `project.json` が先、チャンクが後。各ファイルは一時ファイルに書いてから `rename` する。
- 削除したプロジェクトは `<root>/.trash/<name>-<ミリ秒タイムスタンプ>[-<連番>]/` へ移動する。`.` で始まるディレクトリは一覧から除外する。
- 既存の MCP ツールの引数とレスポンス文面は変えない（`deleteProject` に移動先を書き足すのだけは可）。
- 性能目標：400×80×400 の `fillBox` 1 回が 10 秒以内（メモリ上のみ）、ヒープ増加が 200 MB 以下。保存込みでは 15 秒以内。通常の呼び出しの保存は 1 秒以内。
- コード、コメント、コミットメッセージは英語でよい（既存コードに合わせる）。ドキュメント（`CLAUDE.md`）は日本語。

## Review Focus

- 負の座標がチャンク境界をまたぐ場合（x = -1 はチャンク -1 のオフセット 15、x = -16 はチャンク -1 のオフセット 0、x = -17 はチャンク -2）でも、正しく読み書きできること → Task 1 のテストで固定する。
- 再読み込みしたプロジェクトの `getBoundingBox()` / `getBlockCounts()` / `blockCount` が、保存前と完全に一致すること → Task 2 のテストで固定する。
- `removeBlock` でチャンクが空になったあとに保存すると、そのチャンクのファイルが消え、再読み込みしても復活しないこと → Task 2 のテストで固定する。
- `createProject('Foo')` のあとに `createProject('foo')` を呼ぶとエラーになること（ディスク上の判定もメモリ上の判定も、大文字と小文字を区別しない）→ Task 3 のテストで固定する。
- 保存が失敗したとき、ツールの結果が `isError: true` になり、文面で「メモリ上には適用済み」と伝えること。次の変更のときに、前回保存できなかったチャンクも一緒に書かれること → Task 3 のテストで固定する。

---

### Task 1: チャンクストア化した `BuildProject`



**Files:**
- Modify: `src/core/build-project.ts`（全面的に書き直す）
- Modify: `src/schematic/connections.ts:177` 付近（`project.voxels` の走査を `forEachBlock` に置き換える）
- Modify: `src/preview/server.ts:114` 付近（同上）
- Modify: `test/core/build-project.test.ts:40`（`voxels.size` を `blockCount` に置き換える）
- Test: `test/core/build-project.test.ts`（追記）

**Interfaces:**
- Produces（`src/core/build-project.ts`）:
  - `export const CHUNK_SIZE = 16`
  - `export function chunkKey(cx: number, cy: number, cz: number): string` → `"cx,cy,cz"`
  - `export function parseChunkKey(key: string): { cx: number; cy: number; cz: number }`
  - `voxelKey` / `parseVoxelKey` / `BoundingBox` は既存のまま残す
  - `class BuildProject`
    - `constructor(name: string)`
    - `setBlock(pos: Vec3, block: BlockState): void`
    - `getBlock(pos: Vec3): Readonly<BlockState> | undefined`
    - `removeBlock(pos: Vec3): void`
    - `forEachBlock(cb: (pos: Vec3, block: Readonly<BlockState>) => void): void`
    - `get blockCount(): number`
    - `getBoundingBox(): BoundingBox | null`（書き込みがあるまでキャッシュする）
    - `getBlockCounts(): Record<string, number>`（個数 0 の ID は含めない）
    - 永続化用:
      - `getPalette(): readonly (Readonly<BlockState> | null)[]`（`[0]` は `null`）
      - `getChunk(key: string): Uint16Array | undefined`
      - `getDirtyChunkKeys(): string[]`（変更されたチャンク。空になって削除されたチャンクも含む）
      - `clearDirty(keys: Iterable<string>): void`
      - `static fromStored(name: string, palette: (BlockState | null)[], chunks: Map<string, Uint16Array>): BuildProject`（個数と非 0 セル数をチャンクから数え直す。dirty は空）

- [ ] **Step 1: 失敗するテストを書く**（`test/core/build-project.test.ts` に追記）

```ts
it('reads and writes across negative chunk boundaries', () => {
  const p = new BuildProject('t');
  const stone = { id: 'minecraft:stone' };
  for (const x of [-17, -16, -1, 0, 15, 16]) p.setBlock({ x, y: -1, z: x }, stone);
  for (const x of [-17, -16, -1, 0, 15, 16]) expect(p.getBlock({ x, y: -1, z: x })).toEqual(stone);
  expect(p.getBlock({ x: -2, y: -1, z: -2 })).toBeUndefined();
  expect(p.blockCount).toBe(6);
  expect(p.getBoundingBox()).toEqual({ min: { x: -17, y: -1, z: -17 }, max: { x: 16, y: -1, z: 16 } });
});

it('treats blocks with the same id but different properties as distinct palette entries', () => {
  const p = new BuildProject('t');
  p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' } });
  p.setBlock({ x: 1, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { half: 'bottom', facing: 'north' } });
  p.setBlock({ x: 2, y: 0, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'south', half: 'bottom' } });
  expect(p.getPalette().length).toBe(3); // null + 2 entries
  expect(p.getBlockCounts()).toEqual({ 'minecraft:oak_stairs': 3 });
});

it('stores air as a real block and removeBlock unsets a cell', () => {
  const p = new BuildProject('t');
  p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:air' });
  expect(p.getBlock({ x: 0, y: 0, z: 0 })).toEqual({ id: 'minecraft:air' });
  p.removeBlock({ x: 0, y: 0, z: 0 });
  expect(p.getBlock({ x: 0, y: 0, z: 0 })).toBeUndefined();
  expect(p.blockCount).toBe(0);
  expect(p.getBoundingBox()).toBeNull();
  expect(p.getBlockCounts()).toEqual({});
});

it('drops an emptied chunk but still reports it as dirty', () => {
  const p = new BuildProject('t');
  p.setBlock({ x: 20, y: 0, z: 0 }, { id: 'minecraft:stone' });
  p.clearDirty(p.getDirtyChunkKeys());
  p.removeBlock({ x: 20, y: 0, z: 0 });
  expect(p.getChunk(chunkKey(1, 0, 0))).toBeUndefined();
  expect(p.getDirtyChunkKeys()).toEqual([chunkKey(1, 0, 0)]);
});

it('invalidates the cached bounding box on write', () => {
  const p = new BuildProject('t');
  p.setBlock({ x: 0, y: 0, z: 0 }, { id: 'minecraft:stone' });
  expect(p.getBoundingBox()?.max.x).toBe(0);
  p.setBlock({ x: 5, y: 0, z: 0 }, { id: 'minecraft:stone' });
  expect(p.getBoundingBox()?.max.x).toBe(5);
});

it('throws once the palette exceeds 65535 states', () => {
  const p = new BuildProject('t');
  for (let i = 0; i < 65535; i++) p.setBlock({ x: i, y: 0, z: 0 }, { id: 'minecraft:stone', properties: { n: String(i) } });
  expect(() => p.setBlock({ x: 0, y: 1, z: 0 }, { id: 'minecraft:stone', properties: { n: 'over' } })).toThrow(/palette/i);
});

it('rebuilds counts from stored chunks', () => {
  const p = new BuildProject('t');
  p.setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:stone' });
  p.setBlock({ x: -40, y: 2, z: 3 }, { id: 'minecraft:dirt' });
  const chunks = new Map(p.getDirtyChunkKeys().map((k) => [k, p.getChunk(k)!.slice()]));
  const q = BuildProject.fromStored('t', [...p.getPalette()] as (BlockState | null)[], chunks);
  expect(q.blockCount).toBe(2);
  expect(q.getBlockCounts()).toEqual(p.getBlockCounts());
  expect(q.getBoundingBox()).toEqual(p.getBoundingBox());
  expect(q.getDirtyChunkKeys()).toEqual([]);
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `pnpm exec vitest run test/core/build-project.test.ts`
Expected: FAIL（`chunkKey` / `removeBlock` などが存在しない）

- [ ] **Step 3: `BuildProject` を書き直す**

チャンク検索は、直前に触ったチャンクのキーと配列をキャッシュして、連続する書き込みを速くする。パレット番号の割り当てには `blockStateKey()`（`src/core/types.ts`）を使う。`connections.ts` と `preview/server.ts` は `forEachBlock` に置き換える。`connections.ts` は位置ごとの `voxelKey(pos)` で上書き結果を作るのを維持する。

- [ ] **Step 4: 全テストが通ることを確認する**

Run: `pnpm test`
Expected: 全テストと型チェックが PASS（`writer.test.ts` と `connections.test.ts` はテストを書き換えずに通ること）

- [ ] **Step 5: コミット**

```bash
git add src/core/build-project.ts src/schematic/connections.ts src/preview/server.ts test/core/build-project.test.ts
git commit -m "refactor: store voxels in 16^3 Uint16Array chunks with an append-only palette"
```

---

### Task 2: `project-store.ts`（ディスクの読み書き）



**Files:**
- Create: `src/core/project-store.ts`
- Test: `test/core/project-store.test.ts`（`fs.mkdtempSync(os.tmpdir())` の一時ディレクトリを使い、`afterEach` で削除する）

**Interfaces:**
- Consumes: Task 1 の `BuildProject.getPalette / getChunk / getDirtyChunkKeys / clearDirty / fromStored`、`parseChunkKey`
- Produces（`src/core/project-store.ts`）:
  - `export const FORMAT_VERSION = 1`
  - `export function projectDir(root: string, name: string): string`
  - `export function listStoredProjects(root: string): string[]`（`root` がなければ `[]`。`.` で始まるディレクトリと、`project.json` がないディレクトリは除外する）
  - `export function saveProject(root: string, project: BuildProject): void` — `project.json` を書き、次に dirty なチャンクを書くか消し、成功したチャンクだけ `clearDirty` する。`createdAt` は既存の `project.json` から引き継ぐ。ディレクトリがなければ作る
  - `export function loadProject(root: string, name: string): BuildProject` — 未知の `formatVersion`、壊れた JSON、壊れたチャンクに対しては、`Error` を投げる。メッセージにはディレクトリのパスを含める
  - `export function moveProjectToTrash(root: string, name: string): string` — 移動先の絶対パスを返す

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('round-trips a project through disk', () => {
  const p = new BuildProject('town');
  fillBox(p, { x: -20, y: -3, z: -20 }, { x: 20, y: 5, z: 20 }, { id: 'minecraft:stone' });
  p.setBlock({ x: 0, y: 6, z: 0 }, { id: 'minecraft:oak_stairs', properties: { facing: 'east', half: 'bottom' } });
  p.setBlock({ x: 1, y: 6, z: 0 }, { id: 'minecraft:air' });
  saveProject(root, p);
  const q = loadProject(root, 'town');
  expect(q.blockCount).toBe(p.blockCount);
  expect(q.getBlockCounts()).toEqual(p.getBlockCounts());
  expect(q.getBoundingBox()).toEqual(p.getBoundingBox());
  expect(q.getBlock({ x: -20, y: -3, z: -20 })).toEqual({ id: 'minecraft:stone' });
});

it('writes only dirty chunks on subsequent saves', () => {
  // save once, record mtimes of every chunk file, change one block in chunk (0,0,0), save,
  // expect only chunks/0_0_0.bin to have a newer mtime (or: spy on writeFileSync/renameSync count === 2: project.json + 1 chunk)
});

it('deletes the file of a chunk that became empty', () => {
  // set one block at (20,0,0), save, removeBlock, save
  expect(existsSync(join(projectDir(root, 'p'), 'chunks', '1_0_0.bin'))).toBe(false);
  expect(loadProject(root, 'p').blockCount).toBe(0);
});

it('lists stored projects but not trash or stray folders', () => {
  // save 'a' and 'b', mkdir root/'stray' without project.json, moveProjectToTrash(root, 'b')
  expect(listStoredProjects(root).sort()).toEqual(['a']);
  expect(listStoredProjects(join(root, 'missing'))).toEqual([]);
});

it('moves to a unique trash folder each time', () => {
  // save 'x', trash it, save 'x' again, trash it again within the same millisecond (mock Date.now to a constant)
  // expect two distinct returned paths, both existing, both under root/.trash
});

it('reports the directory when project.json is corrupt or has an unknown formatVersion', () => {
  // write '{not json' → loadProject throws /town/ path; write {formatVersion: 99,...} → throws /formatVersion/
});

it('preserves createdAt across saves and updates updatedAt', () => {});
```

テスト本文のコメント部分は、書かれた期待値どおりに実装者が具体化する。

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm exec vitest run test/core/project-store.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: `project-store.ts` を実装する**

アトミックな書き込みは `writeFileSync(tmp)` → `renameSync(tmp, dest)`。一時ファイル名は `dest + '.tmp'`。チャンクのバイト列は `Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)` を `gzipSync` したもの。読み込み時に、Node が動いているマシンがビッグエンディアンなら変換する（`os.endianness()`）。展開後の長さが 8,192 バイトでなければ「壊れたチャンク」として扱う。

- [ ] **Step 4: 通ることを確認する**

Run: `pnpm exec vitest run test/core/project-store.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/project-store.ts test/core/project-store.test.ts
git commit -m "feat: add on-disk project store with atomic chunk writes and trash"
```

---

### Task 3: `ProjectManager` の永続化と、ツール呼び出し後の自動保存



**Files:**
- Modify: `src/core/project-manager.ts`
- Modify: `src/server.ts`（`createServer` のオプション、変更系ツールのラップ）
- Modify: `src/tools/project-tools.ts`（`deleteProject` の文面に移動先を書き足す）
- Modify: `.gitignore`（`projects/` を追加）
- Test: `test/core/project-manager.test.ts`（追記）、`test/server.test.ts`（追記）

**Interfaces:**
- Consumes: Task 2 の `listStoredProjects / saveProject / loadProject / moveProjectToTrash`
- Produces:
  - `new ProjectManager(options?: { dataDir?: string })` — `dataDir` がなければ永続化しない（既存の挙動）
  - `ProjectManager.createProject(name)` — メモリ上かディスク上に、大文字と小文字を区別せずに同名があればエラー。`dataDir` があれば、すぐに `saveProject`
  - `ProjectManager.switchProject(name)` / `getProject(name)` — 未読み込みならディスクから読み込む（`getProject` はアクティブを変えない。見つからなければ `undefined`、壊れていれば例外）
  - `ProjectManager.listProjects()` — メモリ上とディスク上の和集合（重複なし）
  - `ProjectManager.deleteProject(name): { trashedTo?: string }`
  - `ProjectManager.saveActive(): void` — `dataDir` がなければ何もしない。失敗したら例外をそのまま投げる
  - `createServer(options?: { dataDir?: string })` — `src/index.ts` は `createServer({ dataDir: process.env.MC_SCHEMA_DATA_DIR ?? './projects' })` を呼ぶ
  - `server.ts` 内の `withSave(manager, run: () => ToolTextResult): ToolTextResult` — `run()` のあとで `manager.saveActive()` を呼ぶ。失敗したら `{ content: [{ type: 'text', text: \`Change applied in memory but could not be saved to disk: ${message}. Do not repeat the operation; it will be saved with the next change.\` }], isError: true }` を返す。`setBlock / setBlocks / fillBox / outlineBox / wall / line / sphere / cylinder` の 8 ツールをこれで包む

- [ ] **Step 1: 失敗するテストを書く**（`test/core/project-manager.test.ts`、一時ディレクトリを使う）

```ts
it('survives a restart', () => {
  const a = new ProjectManager({ dataDir: root });
  a.createProject('town');
  a.getActive().setBlock({ x: 1, y: 2, z: 3 }, { id: 'minecraft:stone' });
  a.saveActive();
  const b = new ProjectManager({ dataDir: root });
  expect(b.listProjects()).toEqual(['town']);
  expect(() => b.getActive()).toThrow();
  expect(b.switchProject('town').getBlock({ x: 1, y: 2, z: 3 })).toEqual({ id: 'minecraft:stone' });
});

it('lists an empty project right after creation', () => {
  new ProjectManager({ dataDir: root }).createProject('empty');
  expect(new ProjectManager({ dataDir: root }).listProjects()).toEqual(['empty']);
});

it('rejects names that differ only by case, in memory and on disk', () => {
  const a = new ProjectManager({ dataDir: root });
  a.createProject('Foo');
  expect(() => a.createProject('foo')).toThrow(/already exists/);
  expect(() => new ProjectManager({ dataDir: root }).createProject('FOO')).toThrow(/already exists/);
});

it('getProject lazy-loads without changing the active project', () => {});
it('deleteProject moves the folder to trash and drops it from the list', () => {});
it('keeps working purely in memory when no dataDir is given', () => {}); // existing tests already cover; one explicit check that nothing is written to cwd/projects
```

`test/server.test.ts` に追記する（`saveActive` が失敗する状況は、`dataDir` を、ファイルが置かれているパスに向けて作る。もしくは `vi.spyOn(manager, 'saveActive')` が投げるようにする。`createServer` から manager に触れない場合は、`withSave` を export してそれ単体をテストする）:

```ts
it('reports a failed save as an error without asking to retry', () => {
  // expect result.isError === true and text to match /applied in memory/ and /Do not repeat/
});
it('retries previously unsaved chunks on the next change', () => {
  // first save fails (spy throws once), second change succeeds → loadProject shows both blocks
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `pnpm exec vitest run test/core/project-manager.test.ts test/server.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

`ProjectManager` は、小文字化した名前から正式な名前を引ける対応表を持って、重複判定する。`withSave` は `server.ts` の中に置いて export する。

- [ ] **Step 4: 全テストが通ることを確認する**

Run: `pnpm test`
Expected: 全テストと型チェックが PASS

- [ ] **Step 5: コミット**

```bash
git add src/core/project-manager.ts src/server.ts src/index.ts src/tools/project-tools.ts .gitignore test/core/project-manager.test.ts test/server.test.ts
git commit -m "feat: persist projects to disk and autosave after every mutating tool call"
```

---

### Task 4: 性能テストと CLAUDE.md の更新



**Files:**
- Create: `test/perf/large-fill.test.ts`
- Modify: `vitest.config.ts`（通常の `pnpm test` から `test/perf/**` を外す）
- Modify: `package.json`（`"test:perf": "vitest run --dir test/perf"` などを追加。`exclude` と衝突しない書き方は実装者が選ぶ）
- Modify: `CLAUDE.md`（「アーキテクチャ」の `build-project.ts` の説明を差し替え、永続化と `MC_SCHEMA_DATA_DIR` の説明を追加し、コマンドに `pnpm test:perf` を追加する）

**Interfaces:**
- Consumes: Task 1〜3 のすべて

- [ ] **Step 1: 性能テストを書く**

```ts
it('fills 400x80x400 within 10s and 200MB of heap', () => {
  global.gc?.(); const before = process.memoryUsage().heapUsed; const t0 = performance.now();
  fillBox(project, { x: 0, y: -16, z: 0 }, { x: 399, y: 63, z: 399 }, { id: 'minecraft:stone' });
  expect(performance.now() - t0).toBeLessThan(10_000);
  expect(process.memoryUsage().heapUsed - before).toBeLessThan(200 * 1024 * 1024);
});
it('saves that fill within 15s total and a single-block follow-up save within 1s', () => {});
```

- [ ] **Step 2: 実行して、目標を満たすか確認する**

Run: `pnpm test:perf`
Expected: PASS。FAIL の場合は、計測値を記録してから `setBlock` の経路やチャンク書き込みを最適化し、PASS するまで繰り返す。メモリの計測は `Uint16Array` の外部メモリも含むように `heapUsed + arrayBuffers` で判定してよい。

- [ ] **Step 3: `pnpm test` が性能テストを含まず、引き続き PASS することを確認する**

Run: `pnpm test`
Expected: PASS（perf のテストファイルは実行対象に出てこない）

- [ ] **Step 4: CLAUDE.md を更新してコミット**

```bash
git add test/perf vitest.config.ts package.json CLAUDE.md
git commit -m "test: add large-fill performance test and document persistence"
```
