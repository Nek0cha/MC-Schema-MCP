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
- **`src/schematic/connections.ts`** — フェンス・フェンスゲート・ガラス板・鉄格子・壁の `north`/`south`/`east`/`west`/`up` 接続プロパティを、隣接ブロックから自動計算する後処理。`writeSchematic` の冒頭で呼ばれ、**エクスポート時にのみ**適用される（`BuildProject.voxels` 自体は書き換えない。手動指定した接続プロパティがあっても常に上書きされる）。壁の接続ルールは本家 Minecraft の簡略版（対角ブロックまでは見ない）。
- **`src/tools/*.ts`** — 各MCPツールのハンドラ。ロジックは持たず、`core`/`schematic` を呼んで `textResult()`（`result.ts`）で包むだけ。
- **自動保存** — 変更系の8ツール（`setBlock`/`setBlocks`/`fillBox`/`outlineBox`/`wall`/`line`/`sphere`/`cylinder`）は `server.ts` の `withSave()` で包まれ、ハンドラの後に `manager.saveActive()` が呼ばれる。保存に失敗すると `isError: true` で「メモリ上には適用済み、再実行不要」と返し、dirty は残るので次の変更で再試行される。

### `server.ts` のzodスキーマ

`vec3Shape()` や `blockStateSchema()` などが関数（ファクトリ）になっているのは、複数のツール間で同じzodオブジェクトインスタンスを共有すると `zod-to-json-schema` が `$ref` で参照し合うJSON Schemaを吐いてしまうため。呼び出し側ごとに新しいインスタンスを作ることで、生成されるJSON Schemaがインライン展開される。

### テスト方針

- `writer.test.ts` は `@enginehub/schematicjs` で実際にNBTを読み戻すラウンドトリップテストが中心（パレット文字列が本家の読み込みと整合するか確認するのが狙い）。
- `connections.test.ts` は `resolveConnections()` を直接呼び、隣接ブロックの組み合わせごとに期待するプロパティ値を検証するユニットテストスタイル。

### プロジェクト専用スキル

`.claude/skills/building-minecraft-schematics/` に、このMCPサーバーでビルドを設計するときの心得（シルエット優先、リズムの統一、視認可能な面だけに開口部を作る、など）をまとめたスキルがある。建築物を組み立てる作業ではこれを参照する。
