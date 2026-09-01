# MC-Schema-MCP

Claude Code から Minecraft の建築物を設計し、`.schem`（Sponge Schematic v3）ファイルとして書き出す MCP サーバーです。ブロックはサーバー内の仮想空間（プロジェクト）に配置していき、完成したら1コマンドでエクスポートします。

対象環境: Paper 1.21.11 相当（`DataVersion = 4671`）。WorldEdit/FAWE の `//schematic load` で読み込む前提です。

## セットアップ

```bash
pnpm install
pnpm build
```

Claude Code の MCP サーバー設定に以下を追加してください（`claude_desktop_config.json` や `.mcp.json` など、使用しているクライアントの設定ファイル）。

```json
{
  "mcpServers": {
    "mc-schema-mcp": {
      "command": "node",
      "args": ["/path/to/MC-Schema-MCP/dist/index.js"]
    }
  }
}
```

## 使い方

1. Claude Code 上で建築物の要件を伝える
2. Claude Code が `createProject` → `setBlock`/`fillBox`/`sphere` などのツールでブロックを配置していく
3. 完成したら `exportSchematic` を呼び、`.schem` ファイルを書き出す
4. 書き出されたファイル（`./output/<プロジェクト名>.schem`）を、手動でMinecraftサーバーの schematics フォルダにコピーする
5. FAWE の `//schematic load <名前>` → `//paste` などでワールドに反映する（この工程はこのMCPサーバーの対象外）

**注意:** 座標を設定していないマスは「空気（air）」としてエクスポートされます。既存の地形にかぶせて `//paste` すると、バウンディングボックス内の未設定マスがその地形を消してしまいます。

## ツール一覧

### プロジェクト管理

| ツール | 引数 | 説明 |
|---|---|---|
| `createProject` | `name: string` | 新規プロジェクトを作成し、アクティブにする。名前は英数字・スペース・ハイフン・アンダースコアのみ、先頭は英数字 |
| `listProjects` | - | 存在するプロジェクト名一覧を返す |
| `switchProject` | `name: string` | アクティブプロジェクトを切り替える |
| `deleteProject` | `name: string` | プロジェクトを破棄する |

### ブロック配置

| ツール | 引数 | 説明 |
|---|---|---|
| `setBlock` | `pos: Vec3, block: BlockState` | 1ブロックを配置 |
| `setBlocks` | `blocks: { pos: Vec3, block: BlockState }[]` | 複数ブロックを1回の呼び出しでまとめて配置 |

### 図形プリミティブ

| ツール | 引数 | 説明 |
|---|---|---|
| `fillBox` | `from, to: Vec3, block: BlockState \| Palette` | 直方体を塗りつぶす |
| `outlineBox` | `from, to: Vec3, block` | 直方体の外殻のみ配置 |
| `wall` | `from, to: Vec3, height: number, block` | 2点を結ぶ線分に沿った垂直な壁 |
| `line` | `from, to: Vec3, block` | 2点間の直線 |
| `sphere` | `center: Vec3, radius: number, block, hollow?: boolean` | 球 |
| `cylinder` | `center: Vec3, radius: number, height: number, block, hollow?: boolean` | 円柱 |

`block` には単一の `BlockState`（`{ id: "minecraft:oak_stairs", properties?: { facing: "north" } }`）に加えて、`Palette`（`{ block: BlockState; weight: number }[]`、重み付きランダム配置）も指定できます。半径0〜1の`hollow`指定は、中を空洞にできるだけの厚みがないため無視されます（無音で何も置かれないのではなく、ソリッドとして配置されます）。

フェンス・フェンスゲート・ガラス板・鉄格子・壁は、隣接ブロックとの接続を表す `north`/`south`/`east`/`west`（壁は `up` も）プロパティを手動で指定する必要はありません。`exportSchematic` 時に周囲のブロックを見て自動的に補完・上書きされます（`waterlogged` など接続に関係ないプロパティは温存されます）。

### 情報・出力

| ツール | 引数 | 説明 |
|---|---|---|
| `getBuildInfo` | - | アクティブプロジェクトのサイズ・バウンディングボックス・ブロック数集計を返す |
| `exportSchematic` | - | アクティブプロジェクトを `./output/<projectName>.schem` に書き出し、書き出し先の絶対パスを返す |

**エクスポートの上限:** 1軸あたり32767ブロック、合計1,600万セル（バウンディングボックスの体積、疎に配置していても密なフォーマットとして書き出すため）。超えると `exportSchematic` はエラーを返します。

## 開発

```bash
pnpm test    # vitest + テストファイルの型チェック
pnpm build   # tsc
pnpm start   # ビルド済みサーバーを stdio で起動
```

## 設計ドキュメント

- 設計書: [`docs/superpowers/specs/2026-08-31-mc-schema-mcp-design.md`](docs/superpowers/specs/2026-08-31-mc-schema-mcp-design.md)
- 実装計画: [`docs/superpowers/plans/2026-08-31-mc-schema-mcp.md`](docs/superpowers/plans/2026-08-31-mc-schema-mcp.md)
