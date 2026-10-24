# 月夜の短編集

ニュース、三枚の大アルカナ、短編小説を組み合わせた独立ブログです。静的HTMLのみで動作し、Cloudflare Pagesの無料枠で配信できます。

## 公開フロー（承認型・自動更新）

1. 原稿と制作記録はNotion「ニュース×タロット×短編小説 ログ」に保存する。
2. 公開する作品に次の項目を設定する。
   - `公開先`：`月夜の短編集`
   - `公開タイトル`：読者に表示する正式題名
   - `公開日`：`YYYY-MM-DD`
   - `公開状態`：確認が終わるまでは`下書き`または`確認待ち`
3. 最終確認後、`公開状態`を`公開承認`にする。
4. GitHub Actionsが毎時17分に承認済み作品だけを取得し、作品ページと一覧を生成・検証してPRを作る。
5. 専用ブランチの自動生成PRについて、記事・一覧ファイルだけの変更であることと検証済みコミットを確認し、自動マージしてCloudflare Pagesへの配信を明示的に起動する。コード・設定の変更を含むPRは自動マージしない。
6. 配信成功後、Notionの`公開状態`を`公開済み`へ変更し、`公開URL`を記録する。

制作タイトルの`題名`、Notionのデータベース名、内部メモは公開判定にも公開HTMLにも使いません。`公開タイトル`が空の場合は処理を失敗させ、制作タイトルを代用しない設計です。同じ公開日に複数作品がある場合は、2作目以降を`stories/YYYY-MM-DD-2/`のような連番URLで公開します（1作目のURLは変わりません）。

## 検証と保留

承認済み作品は1件ずつ検証します。公開タイトル空・公開日不正・カード名不正・本文なしの作品は**保留**とし、ほかの正常な作品は公開を続けます。保留作品のHTMLは書かず、公開済み作品の更新が不正な場合は直前の公開版を残します。Notionの承認状態は自動で変更しません。

Notionの取得失敗・設定不正・URL衝突・生成サイトの検証失敗は、全体を停止します。

一度割り当てた公開URLは、公開日を変更しても固定です。

## 同期結果レポート

同期のたびに`sync-report.json`（Git管理外）を出力し、同じ内容をジョブのサマリーに表示します。

- `status`：`prepared`（公開候補あり。保留が混在する場合も含む）／`nothing`／`held_only`／`fatal`
- `candidates`：承認・対象条件を確認して作品検証に進めた件数（変更なしの作品も含む）
- `prepared`：公開候補（`kind`は`new`／`updated`）。この時点では本番公開前
- `held`：保留作品と理由（`EMPTY_TITLE`／`INVALID_DATE`／`INVALID_CARD`／`NO_STORY_BODY`／`WRONG_TARGET`）
- `fatal`：全体停止の理由（`NOTION_FETCH_FAILED`／`CONFIG_INVALID`／`PATH_COLLISION`／`SITE_CHECK_FAILED`。想定外のエラーは`UNEXPECTED`）

全体停止時も可能な限りレポートを出力し、非ゼロで終了します。

## 初回設定

GitHubリポジトリのActions secretsに次を登録します。

- `NOTION_TOKEN`：対象データベースを読み書きできるNotionインテグレーションのトークン
- `CLOUDFLARE_ACCOUNT_ID`：CloudflareアカウントID
- `CLOUDFLARE_API_TOKEN`：対象Pagesプロジェクトを編集できる最小権限のAPIトークン

GitHub ActionsのWorkflow permissionsは`Read and write permissions`を選び、`Allow GitHub Actions to create and approve pull requests`を有効にします。公開の承認点はNotionの`公開承認`です。リポジトリ全体のAllow auto-merge設定は不要です。同期ジョブ内で検証に成功した記事PRだけをマージし、GITHUB_TOKENによるマージではpushワークフローが起動しないため、公開ワークフローをworkflow_dispatchで起動します。公開処理はマージされたコミットSHAを指定して実行します。

## ローカル検証

```sh
npm test
npm run check
npm run build
```

Notionとの同期には`NOTION_TOKEN`が必要です。

```sh
NOTION_TOKEN=... npm run sync:notion
```

## 技術構成

- ビルド不要の静的HTML/CSS
- 外部JavaScript、データベース、サーバー処理なし
- 既存タロットアプリの大アルカナ22枚をSVG資産として再利用
- 既存タロットアプリのリポジトリや公開環境には変更を加えない
- 自動処理はNode.js標準機能だけを使用（追加パッケージなし）
- Cloudflare Pagesへの配信はGitHub ActionsとWranglerを使用
