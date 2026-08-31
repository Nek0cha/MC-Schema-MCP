# MC-Schema-MCP 設計書

- 作成日: 2026-08-31
- 対象環境: Paper 1.21.11（FAWE導入済み）
- ステータス: レビュー待ち

## 1. 背景・目的

Claude Code から Minecraft の建築物を設計・生成し、`.schem`（Sponge Schematic v3）ファイルとして出力する MCP サーバーを TypeScript で実装する。

運用フローは以下の通り。

1. ユーザーが Claude Code 上で建築物の要件を伝える
2. Claude Code が本 MCP サーバーのツールを呼び出し、ブロックを仮想空間に配置していく
3. 完成後、`exportSchematic` ツールで `.schem` ファイルを固定の出力ディレクトリに書き出す
4. ユーザーが手動でそのファイルをサーバーの schematics フォルダにコピーする
5. ユーザーが FAWE の `//schematic load` コマンド等でロードする（MCP サーバーはこの工程に関与しない）

## 2. 技術的前提の検証結果

候補ライブラリとして挙がっていた `@enginehub/schematicjs`（npm, v0.10.0）を調査した結果、以下が判明した。

- README 上は "for loading and saving" と記載されているが、実装（`src/schematic/loader.ts`、`src/schematic/sponge/version3.ts` 等）には読み込み系関数（`loadSchematic` 等）のみが存在し、書き込み・シリアライズ系の関数は存在しない
- 対応形式は Sponge Schematic v1/v2/v3、Structure Block（`.nbt`）、MCEdit（`.schematic`）の読み込みのみ

このため、`.schem` の書き出しは自前実装とする。読み込み専用の `@enginehub/schematicjs` は、自前 writer の出力を検証するテスト用途にのみ利用する。

## 3. アーキテクチャ概要

```
MCPクライアント (Claude Code)
   │  stdio (JSON-RPC, MCP プロトコル)
   ▼
MCPサーバー (TypeScript, @modelcontextprotocol/sdk)
 ├─ ProjectManager        … 名前付き複数プロジェクトを管理
 │    └─ BuildProject     … 1建築 = スパースなボクセルマップ
 ├─ Tools 層
 │    ├─ プロジェクト管理: createProject / listProjects / switchProject / deleteProject
 │    ├─ 低レベル: setBlock / setBlocks
 │    ├─ 中レベル図形: fillBox / outlineBox / wall / line / sphere / cylinder
 │    ├─ 情報系: getBuildInfo
 │    └─ 出力: exportSchematic
 └─ Schematic Writer 層 (自前実装)
      └─ Sponge Schematic v3 NBT シリアライザ（@enginehub/nbt-ts ベース）
```

サーバーは stdio トランスポートで動作し、Claude Code の MCP クライアント設定から `node dist/index.js` として起動される想定。

## 4. データモデル

```typescript
type BlockState = {
  id: string; // 例: "minecraft:oak_stairs"
  properties?: Record<string, string>; // 例: { facing: "north", half: "bottom" }
};

type Vec3 = { x: number; y: number; z: number };

class BuildProject {
  name: string;
  voxels: Map<string, BlockState>; // key = `${x},${y},${z}`

  setBlock(pos: Vec3, block: BlockState): void;
  getBoundingBox(): { min: Vec3; max: Vec3 } | null; // voxels が空なら null
  getBlockCounts(): Record<string, number>; // id別集計
}

class ProjectManager {
  projects: Map<string, BuildProject>;
  activeProjectName: string | null;

  createProject(name: string): void;
  switchProject(name: string): void;
  deleteProject(name: string): void;
  listProjects(): string[];
  getActive(): BuildProject; // アクティブプロジェクトが無ければエラー
}
```

- ブロックは「シンプル ID + properties オブジェクト」で指定する。blockstate 文字列（`minecraft:oak_stairs[facing=north,half=bottom]`）への合成は Schematic Writer 層で行う。
- 座標はワールド座標に依存しない自由な整数座標。原点はユーザー側で特に意識する必要はなく、`exportSchematic` 実行時にバウンディングボックスの最小値を自動計算し、それを原点としてシフトしてから書き出す。

## 5. MCP ツール一覧

### プロジェクト管理

| ツール | 引数 | 説明 |
|---|---|---|
| `createProject` | `name: string` | 新規プロジェクトを作成し、アクティブにする |
| `listProjects` | - | 存在するプロジェクト名一覧を返す |
| `switchProject` | `name: string` | アクティブプロジェクトを切り替える |
| `deleteProject` | `name: string` | プロジェクトを破棄する |

### 低レベル・プリミティブ

| ツール | 引数 | 説明 |
|---|---|---|
| `setBlock` | `pos: Vec3, block: BlockState` | 1ブロックを配置 |
| `setBlocks` | `blocks: { pos: Vec3, block: BlockState }[]` | 複数ブロックを1回の呼び出しでまとめて配置（トークン節約用） |

### 中レベル・図形プリミティブ

| ツール | 引数 | 説明 |
|---|---|---|
| `fillBox` | `from: Vec3, to: Vec3, block: BlockState \| Palette` | 直方体を塗りつぶす |
| `outlineBox` | `from: Vec3, to: Vec3, block: BlockState` | 直方体の外殻のみ配置 |
| `wall` | `from: Vec3, to: Vec3, height: number, block: BlockState` | 2点を結ぶ線分に沿った垂直な壁 |
| `line` | `from: Vec3, to: Vec3, block: BlockState` | 2点間の直線 |
| `sphere` | `center: Vec3, radius: number, block: BlockState, hollow?: boolean` | 球 |
| `cylinder` | `center: Vec3, radius: number, height: number, block: BlockState, hollow?: boolean` | 円柱 |

`Palette` は `{ block: BlockState; weight: number }[]` の形式で、複数ブロックの重み付きランダム配置（WorldEdit のブロックパターン相当）に対応する。中レベルツールは内部で低レベルの voxel セットに展開される。

### 情報・出力

| ツール | 引数 | 説明 |
|---|---|---|
| `getBuildInfo` | - | アクティブプロジェクトのサイズ、原点、ブロック数集計、バウンディングボックスを返す |
| `exportSchematic` | - | アクティブプロジェクトを `./output/<projectName>.schem` に書き出し、書き出し先のパスを返す |

各ツールの引数バリデーションには `zod` を用いる。

## 6. Schematic Writer（Sponge Schematic v3）

自前実装により、以下の NBT 構造を gzip 圧縮した `.schem` ファイルとして書き出す。

```
Schematic (Compound)
├─ Version: 3 (Int)
├─ DataVersion: 4671 (Int)   ※ Minecraft 1.21.11 相当
├─ Width / Height / Length (Short)
├─ Offset: [x, y, z] (IntArray)  ※ 通常 [0, 0, 0]
├─ Blocks (Compound)
│   ├─ Palette (Compound: blockstate文字列 -> Int ID)
│   ├─ Data (ByteArray, VarInt符号化されたパレットIDの並び、XZY順)
│   └─ BlockEntities (List)  ※ v1では空リストでよい
└─ Metadata (Compound, 任意)
```

- NBT のバイナリ構築には `@enginehub/nbt-ts`（`@enginehub/schematicjs` の依存パッケージ）を利用する。
- `BlockEntities` および `Entities` への対応は本バージョンのスコープ外とする（YAGNI）。将来必要になった時点で追加する。
- `DataVersion` の値はゲームバージョン更新時に手動で見直す前提の定数として管理する（`src/schematic/data-version.ts`）。

## 7. テスト戦略

自前 Writer の正しさは、読み込み専用である `@enginehub/schematicjs` の `loadSchematic()` を使ったラウンドトリップ検証で担保する。

1. **Unit テスト**: `setBlock` 〜 `fillBox` 等の図形プリミティブが期待通りの voxel を生成するかを検証
2. **ラウンドトリップテスト**: 自前 Writer で書き出した `.schem` を `schematicjs` の `loadSchematic()` で読み戻し、元の voxel データと一致することを Vitest で検証
3. 実機（Paper + FAWE）での目視確認はユーザー側で実施する（本 MCP サーバーのスコープ外）

## 8. パッケージ構成

パッケージマネージャは `pnpm` を使用する。モノレポ化するほどの規模ではないため単一パッケージ構成とする。

```
mc-schema-mcp/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # MCPサーバーエントリポイント (stdio)
│   ├── tools/
│   │   ├── project.ts        # createProject 等
│   │   ├── primitives.ts     # setBlock, setBlocks
│   │   ├── shapes.ts         # fillBox, wall, sphere ...
│   │   └── export.ts         # getBuildInfo, exportSchematic
│   ├── core/
│   │   ├── build-project.ts  # BuildProject クラス
│   │   └── project-manager.ts
│   └── schematic/
│       ├── writer.ts         # Sponge v3 NBT writer（自前実装）
│       └── data-version.ts   # DataVersion 定数
├── output/                   # .schem 書き出し先（.gitignore 対象）
└── test/
    └── schematic-roundtrip.test.ts
```

### 主要依存パッケージ

- `@modelcontextprotocol/sdk` — MCP サーバー実装
- `@enginehub/nbt-ts` — NBT バイナリ構築
- `@enginehub/schematicjs` — テスト時の読み込み検証専用（本番の書き出しには使用しない）
- `zod` — MCP ツール引数のバリデーション
- `vitest` — テスト

## 9. スコープ外（YAGNI）

以下は本バージョンでは実装しない。将来要望があれば別途設計する。

- undo / redo
- ブロック ID・properties の Minecraft レジストリに対するバリデーション
- ASCII 断面図等のビジュアルプレビュー
- BlockEntities（看板・チェスト内容等）・Entities への対応
- ビルド結果の自動 FAWE ロード（ユーザーが手動でコピー・ロードする運用のため対象外）
