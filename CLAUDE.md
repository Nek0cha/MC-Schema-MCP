# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 概要

Claude Code から Minecraft の建築物を設計し、`.schem`（Sponge Schematic v3）ファイルとして書き出す MCP サーバー（stdio transport）。対象環境は Paper 1.21.11 相当（`DataVersion = 4671`、`src/schematic/data-version.ts`）。

## コマンド

```bash
pnpm install
pnpm build          # tsc でビルド（dist/）
pnpm test           # vitest run（全テスト） + test/ の型チェック
pnpm test:watch     # vitest watch モード
pnpm test:perf      # 大規模フィル（400x80x400）の性能テスト（通常の pnpm test には含まれない）
pnpm start          # ビルド済みサーバーを stdio で起動
```

単体テストを1ファイルだけ回す場合:

```bash
pnpm exec vitest run test/schematic/connections.test.ts
```

## アーキテクチャ

### レイヤー構成

```
index.ts -> server.ts (MCPツール登録) -> tools/*.ts (薄いハンドラ) -> core/*.ts, schematic/*.ts
```

- **`src/core/build-project.ts`** — `BuildProject` はビルドの実体。ボクセルは 16×16×16 のチャンク（`Uint16Array`、値はプロジェクト単位のパレット番号、`0` は未設定）に保存し、**後勝ち（last write wins）** で書き込む。パレットは追記のみで番号は変わらない（上限 65,535 種類）。`minecraft:air` は通常のブロックとして保存され、未設定に戻すには `removeBlock` を使う。全ブロックの走査は `forEachBlock(cb)`、取得は `getBlock(pos)`。変更されたチャンクは dirty として追跡され、保存時に書き出される。`voxelKey(pos)` は `writer.ts`/`connections.ts` の位置キー形式として共用。
- **`src/core/project-manager.ts`** — 複数の `BuildProject` を名前で管理し、アクティブなプロジェクトを切り替える。MCPサーバーは `ProjectManager` を1つだけ持つ（プロセス内でグローバル）。`dataDir` を渡した場合のみ永続化され、起動時にディスク上のプロジェクト名を把握して、`switchProject`/`getProject` で初めて読み込む（遅延読み込み）。名前の重複判定は大文字と小文字を区別しない。`deleteProject` はディレクトリを `.trash/` へ移動するだけで消さない。`dataDir` なしならメモリ上だけで動く（テストの既定）。
- **`src/core/project-store.ts`** — ディスクの読み書き。保存先は `MC_SCHEMA_DATA_DIR`（未設定なら `./projects`、`.gitignore` 済み）の `<name>/project.json`（`formatVersion`、パレット、日時）と `<name>/chunks/<cx>_<cy>_<cz>.bin`（gzip 圧縮した Uint16 リトルエンディアン）。dirty なチャンクだけを書き、`project.json` を先、チャンクを後にし、各ファイルは一時ファイル経由の `rename` でアトミックに置き換える。空になったチャンクのファイルは削除する。
- **`src/core/shapes.ts`** — `fillBox`/`outlineBox`/`wall`/`line`/`sphere`/`cylinder` は全部 `BuildProject.setBlock` の組み合わせに過ぎない。`Palette`（重み付きランダムなブロック選択）はここで1マスずつ解決される。
- **`src/schematic/writer.ts`** — `writeSchematic(project)` が `BuildProject` を gzip 圧縮済みの `.schem` バイト列（NBT）にシリアライズする。バウンディングボックスをそのまま密なフォーマットで書き出すため、疎な配置でも軸あたり32767・合計1,600万セルの上限がある。
- **`src/schematic/connections.ts`** — フェンス・フェンスゲート・ガラス板・鉄格子（`*_bars`。銅の格子を含む）・壁の `north`/`south`/`east`/`west`/`up` 接続プロパティを、隣接ブロックから自動計算する後処理。`writeSchematic` の冒頭で呼ばれ、**エクスポート時にのみ**適用される（`BuildProject` 自体は書き換えない。手動指定した接続プロパティがあっても常に上書きされる）。ガラス板・フェンス・壁は本家と同じく、ガラスブロックを含むしっかりした面に接続し、葉・カボチャ・スイカ・シュルカーボックス・バリアには接続しない。木のフェンスとネザーレンガのフェンスは互いに接続しない。壁の接続ルールは本家の簡略版（対角ブロックまでは見ない）。`findIsolatedConnectables()` は水平方向に相手がなく細い柱になるガラス板と格子の座標を返し、`getBuildInfo`/`exportSchematic` のレスポンス末尾に `Warning: ... isolated ...` として付く（フェンスと壁は単独の柱が普通なので対象外。自動修正はしない）。
- **`src/core/random.ts`** — シード付き乱数（mulberry32）`createRng(seed?)` と、重み付きパレットの抽選 `pickFromPalette(value, rng)`。ランダムを使う新規ツールは任意の `seed` を受け取り、セルを y → z → x の昇順に走査して乱数を引くので、同じ `seed` なら同じ結果になる。既存の `shapes.ts` は `Math.random` のまま。
- **`src/core/block-match.ts`** — `*` ワイルドカード付きのブロック一致判定 `matchesAny` と、置き換え時のプロパティ引き継ぎ `applyReplacement`（`keepProperties`: `auto` は ID の最後の `_` より後ろが一致するときだけ引き継ぐ。`wall_` を含む壁掛けと据え置きの組は引き継がない）。
- **`src/core/transform.ts`** — Y 軸周りの 90 度単位の回転（真上から見て時計回り）と X/Z 反転（**反転が先、回転が後**）。`transformOffset` は座標、`transformBlockState` は `facing`/`axis`/`rotation`/`north` 等/階段の `shape`/ドアの `hinge`/レールの `shape`/チェストの `type`/`side_chain` を変換して**新しいオブジェクト**を返す。
- **`src/core/region-ops.ts`** — `copyRegion`/`stackRegion`/`replaceInRegion`/`clearRegion`/`decayRegion`。範囲は 3,200 万セルまで。コピーは先に読み取ってから書くので範囲が重なっても壊れない。**未設定のセルは書き込み先を変えず、`minecraft:air` は上書きする。** `decayRegion` は削除するセルを先にすべて決めてから削除し、その後に瓦礫を置く。
- **`src/core/template-store.ts` / `templates.ts`** — テンプレート（建物の再利用）。保存先は `MC_SCHEMA_TEMPLATE_DIR`（未設定なら `./templates`、`.gitignore` 済み。プロジェクトの保存先とは独立）の `<name>.json`（パレット + gzip した Uint16 のブロック列、基準点 `anchor` は最小の角からの相対座標）。名前の重複判定は大文字と小文字を区別せず、削除は `.trash/` への移動。サイズ上限は 2,097,152 セル。`placeTemplate` は **置き換え（`replace`）を先、回転・反転を後** に適用し、変換後の基準点を `at` に合わせる。
- **`src/tools/registry.ts`** — ツールの表（`ToolDef`: 名前、説明、zod スキーマ、`mutating`、`batchable`、ハンドラ）。`server.ts` の登録と `batch` の両方がこの表を使うので、ツールを足すときはここに 1 件足す。`mutating: true` のツールは登録時に `withSave` で包まれる。`batchable: true` は `setBlock`/`setBlocks`/`fillBox`/`outlineBox`/`wall`/`line`/`sphere`/`cylinder`/`copyRegion`/`stackRegion`/`replaceInRegion`/`clearRegion`/`decayRegion`/`placeTemplate` の 14 個だけ。
- **`src/tools/batch-tool.ts`** — `batch`。全操作を各ツールの zod スキーマで事前検証し（1 件でも不正なら 1 件も実行しない）、先頭から順に実行する。実行中のエラーで止まり、適用済みの変更は残してレスポンスに適用済みの件数を書く。保存は `batch` 全体で 1 回。
- **`src/tools/*.ts`** — 各MCPツールのハンドラ。ロジックは持たず、`core`/`schematic` を呼んで `textResult()`（`result.ts`）で包むだけ。
- **自動保存** — `mutating: true` のツール（`setBlock`/`setBlocks`/`fillBox`/`outlineBox`/`wall`/`line`/`sphere`/`cylinder`/`copyRegion`/`stackRegion`/`replaceInRegion`/`clearRegion`/`decayRegion`/`placeTemplate`/`batch`）は `server.ts` の `withSave()` で包まれ、ハンドラの後に `manager.saveActive()` が呼ばれる。保存に失敗すると `isError: true` で「メモリ上には適用済み、再実行不要」と返し、dirty は残るので次の変更で再試行される。

### `registry.ts` のzodスキーマ

`vec3Shape()` や `blockStateSchema()` などが関数（ファクトリ）になっているのは、複数のツール間で同じzodオブジェクトインスタンスを共有すると `zod-to-json-schema` が `$ref` で参照し合うJSON Schemaを吐いてしまうため。呼び出し側ごとに新しいインスタンスを作ることで、生成されるJSON Schemaがインライン展開される。

### テスト方針

- `writer.test.ts` は `@enginehub/schematicjs` で実際にNBTを読み戻すラウンドトリップテストが中心（パレット文字列が本家の読み込みと整合するか確認するのが狙い）。
- `transform.test.ts` は向き・回転・反転の組み合わせを表で検証し、`region-ops.test.ts` は階段の向きと位置が両方正しく変わること、範囲が重なるコピー、`seed` での再現性を確認する。`templates.test.ts` は一時ディレクトリを使う。`batch-tool.test.ts` は `ProjectManager.prototype.saveActive` を spy して、保存が 1 回だけ呼ばれることを確認する。
- `connections.test.ts` は `resolveConnections()` を直接呼び、隣接ブロックの組み合わせごとに期待するプロパティ値を検証するユニットテストスタイル。

### プロジェクト専用スキル

`.claude/skills/building-minecraft-schematics/` に、このMCPサーバーでビルドを設計するときの心得（シルエット優先、リズムの統一、視認可能な面だけに開口部を作る、など）をまとめたスキルがある。建築物を組み立てる作業ではこれを参照する。
