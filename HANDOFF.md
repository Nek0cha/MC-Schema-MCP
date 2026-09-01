# HANDOFF（セッション一時中断メモ）

利用上限到達によるセッション中断のための一時メモ。次のセッションはこれを読んで状況を把握したら、恒久ドキュメント（CLAUDE.md/README.md）に反映すべき内容以外は消してOK。

## 現在の状態（2026-09-01時点）

- ブランチ: `master`、作業ツリーはクリーン、`origin/master` と同期済み
- 直近コミット:
  ```
  eb7abad docs: add implementation plan for the build preview feature
  74d9383 docs: add design spec for the build preview feature
  837f15c fix: address code review findings in connection resolution
  187bc2e Merge pull request #1 from Nek0cha/feature/auto-connect-blocks
  215d68d feat: auto-connect fences, glass panes, iron bars, and walls on export
  ```

## 完了した作業

1. **フェンス/ガラス板/鉄格子/壁の自動接続機能**（`src/schematic/connections.ts`）
   - `exportSchematic` 時に隣接ブロックから `north/south/east/west/up` を自動計算・上書き
   - PR #1 で `master` にマージ済み
   - `/code-review` を回して見つかった3件を修正済み（`master` に直接push済み、コミット `837f15c`）:
     - 壁の `up` 判定が、真上に明示的に置いた `minecraft:air` を「ブロックあり」と誤判定するバグ
     - `parseVoxelKey` の重複ロジックを `build-project.ts` に共通化
     - `resolveConnections` が全voxelを新Mapにコピーしていたのを、fence/pane/wall のoverrideのみ返す設計に変更（`writer.ts` の `blockAt` が `project.getBlock` にフォールバック）
2. `.claude/skills/building-minecraft-schematics/` を `~/.claude/skills/` からリポジトリに組み込み、`exportSchematic` の説明に自動接続の話を追記
3. `CLAUDE.md` 新規作成

## 進行中：機能追加3件（ユーザー承認済み、優先順位順）

`/code-review` 後に「他に改善できるところある？」→「機能追加/改善も探して」に対する提案がこの3つで、ユーザーは3つとも「やろか」と承認済み。

### 1. ビジュアルプレビュー機能 — 設計・計画完了、**実装はこれから**

- 設計書: `docs/superpowers/specs/2026-09-01-build-preview-design.md`
- 実装計画: `docs/superpowers/plans/2026-09-01-build-preview.md`（TDDベース、6タスクに分解済み、セルフレビュー済み・コミット済み）
- 合意した設計の要点:
  - 3Dではなく **2D**（Y軸スライスの断面図、レイヤー切り替えボタン）— 3Dは陰影実装のコストが見合わないと判断して方向転換した
  - 本物のMinecraftテクスチャは使わない（著作権配慮、実装コストの両面で今回は見送り）。色は「主要ブロックは手動マッピング＋その他はIDハッシュから決定的なHSL色」のハイブリッド
  - **ローカルHTTPサーバー方式**（Artifactは不使用 — MCPサーバーは別プロセスでArtifactツールを直接呼べないため）。新ツール `previewBuild` 呼び出し時に遅延起動、`127.0.0.1` 限定でバインド
  - セルをクリックで `x, y, z` をクリップボードにコピー、ホバーで座標+ブロックIDをツールチップ表示、ホイールでズーム、ドラッグでパン
- **再開時の次のアクション**: ユーザーに実行方式（サブエージェント方式 or インライン実行）を確認してから、`superpowers:subagent-driven-development` または `superpowers:executing-plans` スキルで `docs/superpowers/plans/2026-09-01-build-preview.md` を実行する

### 2. 階段の自動`shape`補正 — **ブレスト未着手**

`connections.ts` と同じ精神。曲がり角の階段は隣接階段の`facing`を見て`shape`（`straight`/`inner_left`/`inner_right`/`outer_left`/`outer_right`）を自動計算する。まだ `superpowers:brainstorming` に入っていない。

### 3. コピー・ミラー・回転ツール — **ブレスト未着手**

`copyRegion`/`pasteRegion`/`mirrorRegion`/`rotateRegion` のような新規MCPツール群のアイデア。まだ `superpowers:brainstorming` に入っていない。

## 注意点・ハマったこと

- 一度、`master` で作業中に `git checkout -b` を忘れて直接コミットしてしまった（PR #1マージ後に `master` へ戻っていたことに気づかず）。ユーザー許可を得てそのまま `master` に push した。**作業再開時は毎回 `git branch --show-current` を確認すること。**
- パッケージマネージャは `pnpm`（npmではない）。WSL環境で `npx` を裸で叩くとWindows側の `cmd.exe` に解釈されて壊れることがあるので、`pnpm exec <cmd>` を使うこと。

## 動作確認コマンド

```bash
pnpm test    # vitest run + テストファイルの型チェック
pnpm build   # tsc
```
