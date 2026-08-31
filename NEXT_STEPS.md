# 次回セッションへの引き継ぎ

## 現在の状態

- 設計・計画フェーズが完了し、コミット済み。**実装コードはまだ1行も書いていない。**
- spec: `docs/superpowers/specs/2026-08-31-mc-schema-mcp-design.md`
- 実装計画: `docs/superpowers/plans/2026-08-31-mc-schema-mcp.md`（全11タスク、TDD形式、コード込みで具体化済み）

## 次にやること

1. `superpowers:subagent-driven-development` スキルを使い、上記の実装計画を Task 1 から順に実行する（当初はこの方式で進める予定だった）。
2. 計画は各タスクが「失敗するテストを書く → 実装 → テスト通す → commit」の粒度で完結しているので、そのまま流していけば良い。

## 覚えておくべき前提（詳細はspec/planを参照）

- `@enginehub/schematicjs` は **読み込み専用**（書き込みAPIなし、ソースコードで検証済み）。`.schem` の書き出しは `@enginehub/nbt-ts` を使った自前 Sponge Schematic v3 writer で行う（計画の Task 5）。
- `DataVersion = 4671`（Minecraft 1.21.11 相当、[minecraft.wiki](https://minecraft.wiki/w/Java_Edition_1.21.11) で確認済み）。
- MCP SDK は `@modelcontextprotocol/sdk` **v1.30.0**（npm `latest`）を使う。`main` ブランチは v2 alpha なので参照しないこと。`registerTool` の `inputSchema` は raw な zod shape（`{ name: z.string() }`）で渡す。
- `@enginehub/nbt-ts` の `encode()` はNBTバイナリを返すだけで gzip はしない → `node:zlib` の `gzipSync` を自分で挟む。プレーンな `number` は NBT `Double` になるため、`Int`/`Short` 型のフィールドは必ず `new Int(...)` / `new Short(...)` で明示的にラップする（計画 Task 5 内にコード例あり）。
- ラウンドトリップテストで `@enginehub/schematicjs` の `loadSchematic()` を使う際、そのパレット読み込みは blockstate 文字列の最初の `:` より前を切り捨てる仕様（`minecraft:` が消える）。テストの期待値もそれに合わせて `stripNamespace()` している（計画 Task 5 のテストコード参照）。

## 未着手のタスク一覧（計画ファイルの番号と対応）

1. プロジェクトスキャフォールディング
2. コア型 & BuildProject
3. ProjectManager
4. VarInt エンコーダ
5. Sponge Schematic v3 Writer
6. 図形プリミティブ（box/line/wall）
7. 図形プリミティブ（sphere/cylinder）
8. プロジェクト管理系 MCP ツールハンドラ
9. ブロック・図形系 MCP ツールハンドラ
10. 情報・出力系 MCP ツールハンドラ
11. MCP サーバー配線（`src/server.ts` / `src/index.ts`）
