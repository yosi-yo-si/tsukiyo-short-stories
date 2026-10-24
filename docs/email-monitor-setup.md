# メール通知とWorkerの初回設定（MacへのNode.js導入不要）

メールは自分のGoogle Apps Scriptから固定した自分宛てに送信します。新規メール配信サービスへの登録は不要です。ChatGPTのGmail接続は、この無人処理の認証としては使いません。コード作成・PRのマージだけでは稼働せず、以下のGoogle認可とGitHub secret登録が必要です。

## 1. Google側：メール受信口を作成する

1. 通知を受けたいGoogleアカウントで https://script.google.com/ を開き、新しいプロジェクトを作成。「月夜の短編集 メール通知」などと命名する。
2. リポジトリの `email-relay/Code.gs` をエディターへコピーする。
3. プロジェクト設定で「appsscript.jsonマニフェストファイルをエディタで表示」を有効にし、`email-relay/appsscript.json` の内容に合わせる。
4. `initializeRelay` を選んで1回実行し、Googleのメール送信権限を認可する。トリガーは作成しない。
5. プロジェクト設定 → スクリプトプロパティで `ALERT_TO` が希望する自分のメールアドレスか確認する。必要ならここで変更する。`ALERT_TOKEN` と `MONITOR_TOKEN` は自動生成される。値をチャット・コード・実行ログへ貼らない。
6. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。実行ユーザーは「自分」、アクセスできるユーザーは「全員」。デプロイし、末尾 `/exec` のURLを控える。組織ポリシーで匿名アクセスが禁止されているアカウントではこの構成は利用できない。

固定宛先と共有トークンで保護し、リクエストから宛先は指定できない。外部から通知を受けるための公開URLだが、正しいトークンなしではメールを送らない。1日20通まで、同じ送信IDの再送は48時間抑制する。本文はテキストメールで送る。Googleの送信上限・認可失効やサービス障害では届かない場合がある。Workerの通知集約も維持する。

## 2. GitHub側：secretを登録する

リポジトリ → Settings → Secrets and variables → Actions → Secretsへ登録する。既存のCloudflare・Notionの3件は再利用する。

| Secret | 入れる値 |
|---|---|
| `SYNC_DISPATCH_TOKEN` | このリポジトリだけに限定したGitHub fine-grained PAT。Actionsの読み書き権限が必要。自動付与されるGITHUB_TOKENとは別物 |
| `SYNC_MONITOR_TOKEN` | Googleのスクリプトプロパティ `MONITOR_TOKEN` の値 |
| `ALERT_WEBHOOK_URL` | Google側で発行された `/exec` のURL |
| `ALERT_WEBHOOK_TOKEN` | Googleのスクリプトプロパティ `ALERT_TOKEN` の値 |

既存の `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`NOTION_TOKEN` が必要。Cloudflare APIトークンには対象アカウントの **Workers Scripts: Edit** と **Workers KV Storage: Edit** が必要。Pages専用権限だけでは足りない。セットアップはproduction環境を使用するので、同じ環境またはリポジトリのsecretとして参照できるようにする。同期ジョブでも使う `SYNC_MONITOR_TOKEN` はリポジトリsecretへ登録する。

CloudflareのWorkersで `workers.dev` サブドメインがまだ決まっていなければ、ダッシュボードから初回設定する。設定されていなければセットアップは停止し、勝手な名前では作成しない。

## 3. GitHub Actionsから初回セットアップする

1. この変更をmainへマージする。
2. リポジトリのActions → **Setup or update sync monitor** → **Run workflow**（main）を選ぶ。`send_test_email` をオンにすると固定宛先へテストメールを1通送る。
3. 必須設定の検証、テストメール送信、KV namespace作成または再利用、Worker作成、5件のWorker secret登録を自動で行う。Mac側でnpm・Wranglerは不要。
4. 初回は同期・配信からのレポートURLが未登録なので、Workerのcronを無効にした状態でデプロイする。ジョブが成功したこととメールの受信を確認する。
5. ジョブサマリーの **Callback URL** をコピーし、Settings → Secrets and variables → Actions → **Variables**に `SYNC_MONITOR_URL` として登録する（secretでも可）。URL自体にトークンは含まれない。既存の同名secretがあるとそちらが優先されるので古い値を残さない。
6. **Setup or update sync monitor** をもう一度実行する。URLの一致を確認し、15分おきのcronを有効にして更新する。テストメールが不要なら `send_test_email` をオフにする。
7. `Sync approved Notion stories` をmainで手動実行して、同期レポートの送信成功とWorkerのログを確認する。意図的な障害試験はテスト環境で行う。

生成されるKVバインディングは一時的なデプロイ設定へ組み込み、通常の `worker/wrangler.jsonc` は編集しない。再実行時も `tsukiyo-sync-monitor-state` を再利用する。Workerの再デプロイも同じActionsから実行する。秘密情報の一時ファイルはartifactへ含めず、ジョブ末尾で削除する。既存の作品公開用Pagesデプロイとは別のワークフロー。

## Google側のコードを変更した場合

「デプロイを管理」→対象デプロイの編集→新しいバージョンを選んで更新する。URLが同じならWorker側のURL変更は不要。トークンを更新した場合はGitHub secret更新後にWorkerを再デプロイする。

参考: [Google Web apps](https://developers.google.com/apps-script/guides/web)、[Content Serviceとリダイレクト](https://developers.google.com/apps-script/guides/content)、[MailApp](https://developers.google.com/apps-script/reference/mail/mail-app)、[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)。
