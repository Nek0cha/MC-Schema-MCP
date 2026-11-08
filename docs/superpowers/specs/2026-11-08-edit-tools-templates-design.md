# 設計書: 編集ツール、テンプレート、一括実行、孤立ブロックの警告

- 日付: 2026-11-08
- ステータス: ユーザー確認待ち
- 位置づけ: 改善ロードマップ 4 段階のうち第 2 段階。第 1 段階（`2026-11-08-chunked-storage-persistence-design.md`）の `BuildProject` API（`setBlock` / `getBlock` / `removeBlock` / `forEachBlock` など）と、変更系ツールの後の自動保存（`withSave`）を前提にする。

## 背景・目的

レイドマップ（300〜500 ブロック四方）を作るには、建物を 1 ブロックずつ置いていくやり方では呼び出しの回数が多すぎる。数千回の呼び出しで会話が長くなり、途中で要約されると、LLM が前に置いたものを覚えていられなくなる。そこで、次の作り方ができるようにする。

1. **サンドボックスで建物を作る**：小さいプロジェクトで建物を 1 棟だけ丁寧に作る。
2. **テンプレートとして保存する**：名前と基準点を付けて保存する。
3. **マップに並べる**：回転、反転、ブロックの置き換え（バリエーション）を指定しながら、1 回の呼び出しでまとめて配置する。
4. **崩す**：廃墟らしさを出すために、範囲内をランダムに崩す。

また、円柱の外周などでガラス板が孤立し、細い柱になってしまう問題がある。これは LLM が気づけないことが原因なので、警告を出して知らせる（自動では直さない。ユーザーの決定）。

## ゴール

- WorldEdit の `//copy` + `//paste`、`//stack`、`//rotate`、`//flip`、`//replace` 相当の操作ができる。
- 建物をテンプレートとして保存し、別のプロジェクトに回転や反転をして配置できる。
- 複数の操作を 1 回のツール呼び出しで実行できる。
- 範囲内のブロックを、上ほど崩れやすい形でランダムに崩し、瓦礫を散らせる。
- 孤立したガラス板、鉄格子、フェンスの座標を、`getBuildInfo` と書き出しの結果で知らせる。
- スキル `building-minecraft-schematics` に、これらの使い方と孤立ブロックの心得を追記する。

## 非ゴール

- WorldEdit のようなクリップボードの状態（「直前にコピーしたもの」）。範囲は毎回指定させる。LLM は直前の状態を忘れやすいため、状態を持たない方が事故が少ない。
- テンプレートとの紐付け（元のテンプレートを直したら配置済みの建物にも反映する機能）。配置したブロックは、ただのブロックとしてコピーされる（ユーザーの決定）。
- 90 度単位以外の回転、Y 軸方向の反転、上下逆さまの回転。
- 外部の `.schem` / `.nbt` をテンプレートとして読み込む機能。
- undo。
- 孤立ブロックの自動修正。

## アンチゴール

- 回転したあとに、階段やドアの向きなどのプロパティが回転についてこず、建物の一部だけ向きがおかしくなる。
- 置き換えで、置き換え先のブロックに存在しないプロパティを引き継ぎ、ゲームが読み込めない（または既定値に化ける）ブロック状態を作る。
- 同じ `seed` で同じ操作をしたのに、結果が変わる（再現できない）。
- 一括実行の途中で失敗したとき、どこまで適用されたか分からない。

## 設計

### 0. 共通の約束

- **範囲**：`from` と `to` はどちらの順で渡してもよく、両端を含む直方体を表す（既存の `fillBox` と同じ）。
- **未設定と空気**：第 1 段階のとおり、未設定（何も置いていない）と `minecraft:air`（明示的に置いた空気）は区別する。コピーやテンプレート配置では、**未設定のセルは書き込み先を変えない**。**空気は書き込み先を上書きする**（地形を掘るのに使える）。
- **`seed`**：ランダムを使う操作（パレットを含む置き換え、崩し、パレットを渡した既存ツールを除く新規ツール全般）は、任意の `seed`（整数）を受け取る。同じ `seed`、同じ入力なら同じ結果になる。省略時は毎回ランダム。既存ツール（`fillBox` など）は今回は変えない。
- **重なり**：コピー元とコピー先の範囲が重なっていても、コピー元を先に読み取ってから書き込むので、結果は壊れない。
- **レスポンス**：変更したセル数を返す。例：`Copied 1,234 block(s) to (10, 0, 20)..(25, 12, 31).` 書き込み先の範囲（変換後のバウンディングボックス）を必ず含める。LLM が次の操作の座標を決めるのに使うため。
- 全ツールは第 1 段階の `withSave` で包む。
- **範囲の上限**：1 回の操作で扱う範囲は 3,200 万セル（500×128×500）までとする。超えたらエラーにする。
- **乱数の順序**：ランダムを使う操作は、セルを座標順（y → z → x の昇順）に走査して乱数を引く。チャンクの挿入順に結果が左右されないようにするためである。
- **`BlockState` の再利用**：`BuildProject.setBlock` には、直前と同じ `BlockState` オブジェクト（参照が同じもの）を渡されたときにパレット検索を省くキャッシュがある。そのため、`setBlock` に渡したオブジェクトを後から書き換えて再利用してはいけない。変換したブロックは毎回新しいオブジェクトとして作る。

### 1. 回転と反転（`src/core/transform.ts`）

#### 座標

- 回転は Y 軸周りの 90 度単位。`rotate: 0 | 90 | 180 | 270`。真上から見て**時計回り**（Minecraft の座標で、北 −Z → 東 +X → 南 +Z → 西 −X の順）とする。
- 反転は `flip: 'x' | 'z'`。`'x'` は X 座標を反転する（東西が入れ替わる）、`'z'` は Z 座標を反転する（南北が入れ替わる）。
- 両方を指定した場合は、**反転を先、回転を後**に適用する。

#### プロパティの変換

回転と反転のとき、ブロックの次のプロパティを変換する。対象のプロパティを持たないブロックは、そのまま。

| プロパティ | 回転 | 反転 |
|---|---|---|
| `facing`（north/east/south/west。up/down は不変） | 時計回りに回す | 反転軸に沿った向きだけ入れ替える |
| `axis`（x/z。y は不変） | 90/270 のとき x と z を入れ替える | 不変 |
| `rotation`（0〜15。看板、旗、頭など。0=南、4=西、8=北、12=東） | `(r + 4 × 回転回数) mod 16` | `'z'` の反転（南北入れ替え）: `(8 − r) mod 16`、`'x'` の反転（東西入れ替え）: `(16 − r) mod 16` |
| `north`/`east`/`south`/`west`（値は何でもよい） | 値を回転先の方向へ移す | 値を反転先の方向へ移す |
| `shape`（階段） | 不変 | `inner_left` ⇔ `inner_right`、`outer_left` ⇔ `outer_right` |
| `hinge`（ドア） | 不変 | `left` ⇔ `right` |
| `shape`（レール: `north_south`, `east_west`, `ascending_*`, `north_east` など） | 方向の名前を回転して並べ直す | 方向の名前を反転して並べ直す |
| `type`（チェストの `left`/`right`） | 不変 | `left` ⇔ `right` |
| `side_chain`（棚の `left`/`right`） | 不変 | `left` ⇔ `right` |

- 反転で、`facing` が反転軸と平行な向き（`'x'` の反転なら east/west）のとき、階段の `shape` の左右も入れ替える。これは「反転では、`shape` の左右は**常に**入れ替える」というルールと同じ結果になるので、常に入れ替えでよい。
- 接続系（フェンスやガラス板の `north` など）は書き出し時に再計算されるが、変換しておいても害はないので、一律に変換する。
- 上の表にないプロパティ（`half`、`type: top/bottom`、`waterlogged` など）は変えない。
- 表にない向き依存のブロック（たとえばキノコブロックの面など）は、上の `north`/`east`/`south`/`west` 規則でおおむね正しく変換される。それ以外の例外は実装者の判断で、表に追加してよい。

#### API

```ts
type Rotation = 0 | 90 | 180 | 270;
type Flip = 'x' | 'z';
interface Transform { rotate?: Rotation; flip?: Flip }
function transformBlockState(block: BlockState, t: Transform): BlockState;
function transformOffset(offset: Vec3, t: Transform): Vec3; // 原点 (0,0,0) を中心に変換する
```

### 2. 範囲の操作（`src/core/region-ops.ts`）

#### `copyRegion(from, to, dest, rotate?, flip?)`

- コピー元の範囲を変換して、**変換後の範囲の最小の角**が `dest` に来るように貼り付ける。
- 未設定のセルはコピーしない。空気はコピーする。

#### `stackRegion(from, to, direction, count, gap?)`

- `direction`：`north | south | east | west | up | down`。
- `count`：繰り返す回数（元の範囲は含まない）。1〜256。
- 1 回ずつ「範囲のその軸方向の長さ + `gap`（既定 0）」だけずらして複製する。
- 例：長さ 10 の範囲を `east` に `count: 3` で並べると、x が +10、+20、+30 の位置に複製される。

#### `replaceInRegion(from, to, match, replacement, keepProperties?, seed?)`

- `match`：一致させるブロックのリスト。各要素は `{ id: string, properties?: Record<string, string> }`。
  - `id` には `*` のワイルドカードを使える（例：`minecraft:*_stairs`、`minecraft:stone_brick*`）。`*` 以外の特殊文字はない。`minecraft:` を省略した場合は補う。
  - `properties` を指定した場合、そのすべてが一致するセルだけを対象にする。
- `replacement`：`BlockState` かパレット（既存の `blockOrPaletteSchema` と同じ形）。パレットのときは、セルごとに抽選する。
- `keepProperties`：`'auto' | true | false`。既定は `'auto'`。
  - `true`：元のブロックのプロパティを引き継ぎ、そのうえに置き換え先のプロパティを重ねる。
  - `false`：置き換え先のプロパティだけを使う。
  - `'auto'`：元と置き換え先の ID の**最後の `_` より後ろ**（ID 全体に `_` がなければ ID 全体）が一致するときだけ `true` とする。例：`oak_stairs` → `spruce_stairs` は `stairs` が一致するので引き継ぐ。`oak_stairs` → `stone_bricks` は引き継がない。存在しないプロパティを引き継いで、壊れたブロック状態を作るのを防ぐための近似である。
  - 例外（`'auto'` でも引き継がない）：片方の ID が `wall_` を含み、もう片方が含まない場合。これは壁掛けと据え置きの組で、`oak_wall_sign` → `oak_sign`、`wall_torch` → `torch`、`*_wall_banner` → `*_banner`、`*_wall_hanging_sign` → `*_hanging_sign` などが当たる。壁掛けは `facing`、据え置きは `rotation` を持つというように、プロパティの組が違うためである。この判定は `block-match.ts` に小さな例外表として持つ。
- 未設定のセルは対象外。空気は `match` に `minecraft:air` があれば対象になる。

#### `clearRegion(from, to, mode?)`

- `mode: 'unset' | 'air'`。既定は `'unset'`（未設定に戻す）。`'air'` は空気を明示的に置く（第 4 段階の書き出しで「上書きして消す」意味になる）。

#### `decayRegion(from, to, intensity, options?)`

廃墟化のために、範囲内のブロックをランダムに崩す。

- `intensity`：0〜1。全体の崩れやすさ。
- 各セル（未設定と空気は除く）の削除確率は `p = intensity × w(y)`。`w(y)` は `topBias`（既定 `true`）のとき `0.25 + 0.75 × (y − minY) / max(1, maxY − minY)`、`false` のとき 1。上ほど崩れやすい。
- `protect`：崩さないブロックのリスト（`match` と同じ形式。ワイルドカードを使える）。既定は空。
- `rubble`：既定 `true`。削除したブロックのうち、確率 `rubbleChance`（既定 0.3）で、その列（同じ x, z）を下にたどる。範囲内で最初に見つかった「未設定でも空気でもないセル」の上の、未設定または空気のセルに、瓦礫を 1 個置く。見つからなければ置かない。
- `rubbleBlocks`：瓦礫に使うブロックまたはパレット。既定は `[{ minecraft:cobblestone, 3 }, { minecraft:gravel, 2 }, { minecraft:cobblestone_slab[type=bottom], 2 }]` とする。
- 処理順：まず削除するセルをすべて決め、削除してから、瓦礫を置く。結果が走査順に依存しないようにする。
- `seed`：省略可能。
- レスポンスには、削除数と瓦礫の数を含める。
- 注意：崩した結果、通路がふさがったり、足場がなくなったりしうる。第 4 段階の検証でこれを検出する。スキルに「崩しは検証の前に行い、崩したあとに検証を走らせる」と書く。

### 3. テンプレート（`src/core/template-store.ts`、`src/core/templates.ts`）

#### 保存先と形式

- 既定は `./templates/`。環境変数 `MC_SCHEMA_TEMPLATE_DIR` で変更できる。プロジェクトの保存先とは独立させ、どのマップからでも使えるようにする。
- 1 テンプレート 1 ファイル：`templates/<name>.json`。名前の規則はプロジェクト名と同じ（既存の正規表現）で、重複判定は大文字と小文字を区別しない。

```json
{
  "formatVersion": 1,
  "name": "ruined_apartment_a",
  "description": "4 階建ての集合住宅。正面は南",
  "size": [17, 22, 12],
  "anchor": [8, 1, 11],
  "palette": [null, {"id": "minecraft:stone_bricks"}, ...],
  "blocks": "<base64: size[0]*size[1]*size[2] 個の Uint16 リトルエンディアンを gzip したもの>",
  "createdAt": "..."
}
```

- `blocks` の並びは `index = (y * sizeZ + z) * sizeX + x`。値はパレット番号で、0 は未設定。
- `anchor` は、テンプレートの最小の角からの相対座標。
- サイズの上限は合計 2,097,152 セル（128³）。超えたらエラーにする。

#### ツール

- `saveTemplate(name, from, to, anchor?, description?, overwrite?)`：アクティブなプロジェクトの範囲をテンプレートにする。`anchor` は**絶対座標**で受け取る（範囲の外でもよい）。省略時は、範囲の底面の中心（`x`、`z` は中央の切り捨て、`y` は最小値）。同名のテンプレートがあれば、`overwrite: true` のときだけ上書きする。
- `listTemplates()`：名前、サイズ、説明、基準点の一覧を返す。
- `deleteTemplate(name)`：`templates/.trash/` へ移動する（第 1 段階のプロジェクト削除と同じ方式）。
- `placeTemplate(name, at, rotate?, flip?, replace?, seed?)`：テンプレートを変換して、**変換後の基準点**が `at` に来るように置く。
  - `replace`：配置と同時に行う置き換えのリスト `[{ match, replacement, keepProperties? }]`。意味は `replaceInRegion` と同じだが、テンプレートのブロックに対してだけ適用する。置き換えの後で回転を適用する（つまり `match` はテンプレート内の元の向きのプロパティで書く）。
  - レスポンスには、配置したセル数と、変換後のバウンディングボックス（絶対座標）を含める。
- `placeTemplate` を複数並べるのは、一括実行（下記）で行う。

### 4. 一括実行（`batch` ツール）

- 入力：`{ operations: { tool: string, args: object }[] }`。1〜1,000 件。
- 実行できるツール：`setBlock`、`setBlocks`、`fillBox`、`outlineBox`、`wall`、`line`、`sphere`、`cylinder`、`copyRegion`、`stackRegion`、`replaceInRegion`、`clearRegion`、`decayRegion`、`placeTemplate`。プロジェクトの切り替え、書き出し、プレビュー、テンプレートの保存や削除、`batch` 自身は実行できない（一括実行の途中で対象が変わるのを防ぐため）。
- `args` は、各ツール単体と**同じ zod スキーマ**で検証する。実行前に全件を検証し、1 件でも不正なら 1 件も実行せずにエラーにする。エラー文には、何件目の、どの引数が不正かを書く。
- 実行は先頭から順に行う。実行中にエラーが出たら、そこで止める。結果は `isError: true` にして、「何件目までが適用済みか」と「エラーの内容」を書く。適用済みの変更は残す（メモリ上でもディスク上でも）。
- 保存は最後に 1 回だけ（`batch` 全体を `withSave` で包む）。
- 成功時のレスポンス：件数と、各操作の 1 行の結果（各ツールの結果文）を並べる。50 件を超える場合は、最初の 20 件と最後の 5 件だけ出し、間は省略した件数を書く。
- 実装の要点：各ツールのハンドラを「`withSave` で包まれていない素の関数」と「zod スキーマ」の組として 1 か所の表にまとめ、MCP ツールの登録と `batch` の両方がその表を使う。こうして、ツールを追加したときに `batch` 側の対応漏れが起きないようにする。

### 5. 孤立ブロックの警告

#### 接続判定の修正（先にやる）

調べたところ、`src/schematic/connections.ts` の接続判定には、本家と食い違う点がある（本家の `IronBarsBlock.attachsTo` と `FenceBlock.connectsTo` は、相手の面がしっかりしていれば（sturdy）、ガラスブロックにも接続する。ガラス板と鉄格子は壁（`#walls`）にも接続する）。

- ガラス板と格子：ガラスブロックに**接続する**ように直す。壁（`*_wall`）にも接続するように直す。
- フェンス：ガラスブロックに**接続する**ように直す。木のフェンス同士は接続し、ネザーレンガのフェンスと木のフェンスは接続しない（本家どおり）。
- 壁：ガラスブロック、ガラス板、格子にも接続するように直す。直さないと、ガラス板からは壁に繋がるのに、壁からはガラス板に繋がらないという食い違いが起きる。既存の壁のテストで期待値が変わるものは、本家の挙動に合わせて更新する。
- 格子のファミリーを、`minecraft:iron_bars` だけから `*_bars` に広げる。これで、1.21.9 以降の銅の格子と、その錆びやワックスの違いも含まれる。鎖は `minecraft:chain`、`minecraft:iron_chain`、`*_chain`（銅の鎖）のすべてを「完全なブロックではない」扱いにする。
- 例外として、葉、カボチャ、くり抜かれたカボチャ、ジャック・オ・ランタン、スイカ、シュルカーボックス、バリアには接続しない（本家の `isExceptionForConnection`）。現状の「完全なブロック」判定でこれらが接続扱いになっているので、例外リストに加える。
- この修正は、警告を正しく出すための前提である（ガラス板の隣にガラスブロックを置いて孤立を解消する、という直し方が成り立つため）。

#### 警告

- `findIsolatedConnectables(project): Vec3[]`：ガラス板（`*_pane`）と格子（`*_bars`。鉄格子と銅の格子）のうち、`resolveConnections` の結果で `north`/`south`/`east`/`west` がすべて `false` のものの座標を返す。フェンスと壁は対象外とする。街灯の柱などで単独の柱として使うのが普通なので、対象にすると警告が常に出てしまい、LLM が警告を無視するようになるためである。
- `getBuildInfo` と `exportSchematic` のレスポンスの末尾に、孤立ブロックがあれば次の形で付け加える（0 件なら何も付けない）。

```
Warning: 12 isolated pane/bar/fence block(s) have no horizontal neighbor to connect to and will render as thin posts: (10,5,3), (11,5,4), ... (+2 more). Put a solid block or another pane next to them, or use full glass blocks on diagonal/curved walls.
```

- 座標は最大 20 件まで列挙し、残りは件数で示す。
- `batch` のレスポンスには付けない（`getBuildInfo` で確認する運用にする）。

### 6. スキルへの追記

`.claude/skills/building-minecraft-schematics/SKILL.md` に、次の内容を追記する（既存の文体に合わせる。記述の粒度は実装者に任せる）。

- 大きいマップの作り方：サンドボックスのプロジェクトで建物を作る → `saveTemplate` → マップのプロジェクトで `batch` + `placeTemplate` で並べる → `replace` でバリエーションを付ける → `decayRegion` で崩す。
- テンプレートの基準点は「正面の入口の前の地面」に置くと、回転して並べるときに道路に揃えやすい。
- 円柱や斜めの外周にガラス板、鉄格子、フェンスを使うと、孤立して細い柱になりやすい。`getBuildInfo` の警告を確認し、斜めに並ぶ窓にはガラスブロックを使うか、ガラス板の隣に柱を立てる。
- 崩しのあとは通路がふさがっていないか確認する。

### 7. 影響範囲

| ファイル | 変更 |
|---|---|
| `src/core/transform.ts`（新規） | 回転、反転、プロパティの変換 |
| `src/core/region-ops.ts`（新規） | `copyRegion` / `stackRegion` / `replaceInRegion` / `clearRegion` / `decayRegion` |
| `src/core/block-match.ts`（新規） | ワイルドカード付きの `match` 判定と `keepProperties` の判定（置き換え、崩し、テンプレートで共用） |
| `src/core/random.ts`（新規） | シード付き乱数（アルゴリズムは実装者に任せる。例：mulberry32）と、パレットの抽選 |
| `src/core/template-store.ts`（新規）、`src/core/templates.ts`（新規） | テンプレートの読み書きと、保存・配置 |
| `src/schematic/connections.ts` | 接続判定の修正、`findIsolatedConnectables` の追加 |
| `src/tools/*.ts` | 新規ツールのハンドラ。`getBuildInfo` / `exportSchematic` に警告を付ける |
| `src/tools/registry.ts`（新規） | ツールの表（ハンドラ + zod スキーマ）。`server.ts` と `batch` が共用する |
| `src/server.ts` | 表を使った登録に書き換える。`batch` を追加する |
| `.gitignore` | `templates/` を追加する |
| `CLAUDE.md`、スキル | 説明の更新 |

### 8. テスト

- `transform`：4 方向の `facing` を 4 通りの回転と 2 通りの反転で変換した結果の表。`rotation` 16 値の回転と反転。階段の `shape` とドアの `hinge` の反転。レールの `shape`。`north`/`east`/... の移し替え。`transformOffset` で 360 度回すと元に戻ること、同じ軸で 2 回反転すると元に戻ること。
- `copyRegion`：回転なし、90 度回転で、階段の向きと位置が両方正しいこと。未設定のセルが書き込み先を変えないこと、空気は上書きすること。範囲が重なっている場合。
- `stackRegion`：`gap` あり・なし、6 方向。
- `replaceInRegion`：ワイルドカード、`properties` の一致条件、`keepProperties` の 3 モード、パレットと `seed` の再現性。
- `decayRegion`：`seed` での再現性。`intensity: 0` で何も変わらないこと。`intensity: 1`、`topBias: false` で（`protect` 以外）全部消えること。瓦礫が必ず「何かの上」に乗ること。`protect` が守られること。
- テンプレート：保存して読み込む往復。`anchor` と回転を組み合わせた配置位置。`replace` が回転より先に適用されること。上限サイズ。名前の大文字と小文字。ゴミ箱への移動。
- `batch`：事前検証で 1 件も実行されないこと。途中のエラーで、それ以前の操作は残り、レスポンスに適用済みの件数があること。保存が 1 回だけ呼ばれること。禁止ツールを拒否すること。
- 接続：ガラス板とガラスブロック、ガラス板と壁、フェンスとガラスブロック、ガラス板とカボチャ（接続しない）。孤立の検出（円柱の外周に置いたガラス板で、斜めの位置が検出されること）。警告文の形式と、20 件での打ち切り。

## 実装者に任せること

- 乱数のアルゴリズム（シード付きで、プラットフォームによらず決定的であること）
- ファイルとモジュールの細かい分け方（上の表は目安）
- レスポンスの文面の細部（上で決めた要素を含めること）
- プロパティ変換の表にない例外ブロックの追加

## 実装の割り振り（ユーザーの方針）

Sonnet のサブエージェント 1 体が、計画の全タスクを順に通しで実装する。完了後、メインセッションが全体をレビューする。
