import { appendFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { ROOT } from "./site-lib.mjs";

// 外部起動・監視側と合意した同期結果の形式。
// status: prepared | nothing | held_only | fatal
export const REPORT_PATH = path.resolve(ROOT, process.env.SYNC_REPORT_PATH ?? "sync-report.json");

export function currentMainSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function createReport() {
  return {
    status: null,
    ran_at: new Date().toISOString(),
    main_sha: currentMainSha(),
    candidates: 0,
    prepared: [],
    held: [],
    fatal: null
  };
}

function summaryMarkdown(report) {
  const lines = [
    `## Notion同期: ${report.status}`,
    "",
    `- 実行: ${report.ran_at}`,
    `- 基準main: \`${report.main_sha ?? "unknown"}\``,
    `- 検証対象: ${report.candidates}件 ／ 公開候補: ${report.prepared.length}件 ／ 保留: ${report.held.length}件`
  ];
  if (report.prepared.length) {
    lines.push("", "### 公開候補");
    for (const item of report.prepared) lines.push(`- [${item.kind}] ${item.title} → \`${item.path}\``);
  }
  if (report.held.length) {
    lines.push("", "### 保留");
    for (const item of report.held) lines.push(`- ${item.title ?? item.notionPageId}: \`${item.reason_code}\` ${item.message}`);
  }
  if (report.fatal) lines.push("", "### 全体停止", `- \`${report.fatal.reason_code}\` ${report.fatal.message}`);
  return `${lines.join("\n")}\n`;
}

export async function writeReport(report) {
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(report), "utf8");
}

// 同期後の最終検証で失敗した場合、既存レポートを全体停止に更新する。
export async function markSiteCheckFailed(message) {
  let report;
  try {
    report = JSON.parse(await readFile(REPORT_PATH, "utf8"));
  } catch {
    return false;
  }
  report.status = "fatal";
  report.fatal = { reason_code: "SITE_CHECK_FAILED", message };
  await writeReport(report);
  return true;
}
