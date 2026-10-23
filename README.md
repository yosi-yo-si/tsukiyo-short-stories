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
4. GitHub Actionsが毎時17分に承認済み作品だけを取得し、作品ページと一覧を生成してPRを作る。
5. PRの差分を確認してマージすると、既存のCloudflare Pagesプロジェクトへ自動配信する。
6. 配信成功後、Notionの`公開状態`を`公開済み`へ変更し、`公開URL`を記録する。

制作タイトルの`題名`、Notionのデータベース名、内部メモは公開判定にも公開HTMLにも使いません。`公開タイトル`が空の場合は処理を失敗させ、制作タイトルを代用しない設計です。同じ公開日に複数作品がある場合も上書きせず停止します。

## 初回設定

GitHubリポジトリのActions secretsに次を登録します。

- `NOTION_TOKEN`：対象データベースを読み書きできるNotionインテグレーションのトークン
- `CLOUDFLARE_ACCOUNT_ID`：CloudflareアカウントID
- `CLOUDFLARE_API_TOKEN`：対象Pagesプロジェクトを編集できる最小権限のAPIトークン

GitHub ActionsのWorkflow permissionsは`Read and write permissions`を選び、`Allow GitHub Actions to create and approve pull requests`を有効にします。公開の承認点はPRのマージです。

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

