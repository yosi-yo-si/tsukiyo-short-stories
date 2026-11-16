import { loadJson, renderIndexes, writeText } from './site-lib.mjs';

const pages = renderIndexes(await loadJson('content/stories.json'));
await Promise.all([
  writeText('index.html', pages.index),
  writeText('archive-date.html', pages.byDate),
  writeText('archive-cards.html', pages.byCards)
]);
console.log('作品一覧を更新しました。');
