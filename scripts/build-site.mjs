import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./site-lib.mjs";

const dist = path.join(ROOT, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of ["index.html", "archive-date.html", "archive-title.html", "styles.css", "assets", "stories"]) {
  await cp(path.join(ROOT, entry), path.join(dist, entry), { recursive: true });
}
console.log("公開用ファイルを dist/ に作成しました。");

