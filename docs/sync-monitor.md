# 同期の外部起動と監視

このPRのマージだけではWorker・通知は有効になりません。次の設定と手動検証を完了してから運用を開始してください。既存のGitHub定期実行は4時間おきの保険として残ります。

## Workerの設定

1. Cloudflareを操作できる端末で、リポジトリのルートから `npx wrangler@4 kv namespace create STATE` を実行する。
2. 返されたnamespace IDを `worker/wrangler.jsonc` の `kv_namespaces` に設定する：`[{ "binding": "STATE", "id": "実際のID" }]`。IDは秘密情報ではない。未設定のまま運用しない。
3. GitHub fine-grained PATをこのリポジトリだけに発行する。必要権限はActionsの読み書き。Workerはコードの変更・PRのマージ・Notionへの書き込みを行わない。Notionには対象データソースへの読み取りを許可したトークンを用意する。
4. `npx wrangler@4 secret put 名前 --config worker/wrangler.jsonc` で次の値を登録する。値をコードやチャットに貼らない。

| Worker secret | 内容 |
|---|---|
| `GITHUB_TOKEN` | 外部起動用PAT（既存ActionsのGITHUB_TOKENとは別） |
| `NOTION_TOKEN` | 公開承認の有無を読むNotionトークン |
| `MONITOR_TOKEN` | 32バイト以上のランダム値。GitHub側と共有する |
| `ALERT_WEBHOOK_URL` | `{ "text": "通知本文" }` を受け付ける通知先。サービスに応じて変換する受信口を用意する |

5. `npx wrangler@4 deploy --config worker/wrangler.jsonc` で公開する。cronは毎時07/22/37/52分（UTC、15分間隔）。分単位の公開時間は保証しない。
6. GitHub Actions secretsに `SYNC_MONITOR_URL=https://実際のWorkerホスト/report` と `SYNC_MONITOR_TOKEN=MONITOR_TOKENと同じ値` を登録する。未設定ではActionsに警告が出る。既存のCloudflare Pages用トークンでWorker設定ができるとは限らない。

## 役割と失敗時の動作

- WorkerはNotionの公開先と公開承認を絞り込み、`last_edited_time`の降順で先頭1件を取得する。その最大編集時刻が、直近の正常完了した同期の開始時刻（レポートの`ran_at`）以降の場合だけGitHubの `sync-notion.yml` を `ref=main` で起動する。作品検証と承認の再確認は同期本体が行う。
- 実行待ち・実行中の同期があれば起動しない。KVの10分クールダウンは補助であり、厳密なロックではない。KVの反映遅延で重複起動しても、GitHubの共通concurrencyグループで同期を直列化する。
- 同期はジョブ開始時のmainを取得し、その実際のSHAをマージ条件に使う。取り込み・検証後にmainが進んでいれば、最大2回、新しい同期を要求する。古い生成結果の再利用・強制マージはしない。再実行の依頼が成功した実行は、`sync_outcome=retry_requested`で成功終了する。再実行の上限到達・起動APIの失敗は失敗として通知する。判定には`MAIN_CHANGED`エラーコードを使う。
- `sync-report.json` は失敗時にもartifactへ保存する。通知ステップも `always()` で実行する。checkout失敗などで通知スクリプトが動かないケースはWorkerが検知する。
- `prepared`は公開完了ではない。本番デプロイとNotionの公開済み更新を含むジョブの結果は別の `kind=deploy` レポートで受け取る。
- 保留通知は `(notionPageId, reason_code)` で集約する。正常に完了した同期からその保留が消えた時に解除し、再発時は再通知する。fatal・欠落レポートでは保留を解除しない。
- 通知には作品ID・理由コード・Actionsリンクを含める。本文・トークン・内部メモは送らない。詳細は非公開の監視先とActionsサマリーで確認する。
- 毎回のcronで同期とデプロイの実行状況も確認する。1時間以上の待機／実行、完了後30分以上のレポート欠落、未検証の編集があるのに2時間以上同期レポートがない状態を通知する。
- Worker初回起動より前に完了した実行については、レポート欠落を通知しない。Worker自身の完全停止や通知先の故障は自己監視だけでは検知できないため、Cloudflare側の監視または別の外形監視を利用する。
- 通知先が受け付けるまでは通知済みとして保存しない。同じ障害は解消まで集約する。KVの整合性・通知応答喪失により通知が重複する場合はある。
- レポート取得と監視の障害だけを理由に公開承認状態を書き換えない。`held_only`・`nothing`も正常完了として開始時刻を記録する。変更のない保留・承認作品だけでは15分おきの同期を起動せず、編集後に再検証する。失敗・fatal・欠落レポート・再実行依頼だけでは基準時刻を進めない。初回（基準時刻なし）は承認作品があれば起動する。比較が同時刻の場合は安全側に再検証する。GitHubの4時間おきの保険と手動実行はこの抑制に依存しない。

## 初回の実地確認

1. まずこのPRをマージし、GitHubから `Sync approved Notion stories` をmainで手動実行する（`retry_count=0`）。
2. artifact／ジョブサマリーで `status=prepared`、実際のmain SHAと次の公開候補を確認する。すでに公開済みなら `nothing` もあり得る。
   - 満充電 → `stories/2026-10-24-2/`
   - 閉架 → `stories/2026-10-25/`
3. 記事PRの自動マージ、デプロイ成功、実際の2つのURL、Notionの公開済み／公開URLをそれぞれ確認する。
4. Workerを設定後、下書きの検証用作品でタイトル空の保留を試す。初回通知、同じ保留の抑制、解消後の再発通知を確認する。実作品の承認状態を試験用に変更しない。
5. トークン無効・通知受信口の障害はテスト環境で確認する。ローカル自動テストでは全APIをモックし、本番に通信しない。

停止する場合はWorkerのcronを無効にする。GitHubの手動実行と保険の定期実行は独立して継続する。
