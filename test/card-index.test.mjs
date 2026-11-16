import test from 'node:test';
import assert from 'node:assert/strict';
import { cardId, collectCards } from '../scripts/card-index.mjs';
import { renderIndexes } from '../scripts/site-lib.mjs';

const card = (number, name, position, orientation = '正位置') => ({ number, name, position, orientation });
const older = { date: '2026-10-24', path: 'stories/2026-10-24/', title: '古い物語', cards: [card('08', '力', '過去'), card('8', '力の表記揺れ', '未来', '逆位置'), card('12', '吊るされた男', '現在')] };
const newer = { date: '2026-10-25', path: 'stories/2026-10-25/', title: '新しい物語', cards: [card('21', '世界', '過去'), card('08', '力', '現在', '逆位置'), card('12', '吊るされた男', '未来')] };

test('カードの同一性は番号で判定し、配置・正逆や同一作品内の重複を問わず作品数を数える', () => {
  const strength = collectCards([older, newer]).find(c => c.id === 'major-08');
  assert.equal(strength.stories.length, 2);
  assert.deepEqual(strength.stories, [older, newer]);
  assert.deepEqual(collectCards([older, newer], { position: '未来', orientation: '逆位置' }).find(c => c.id === 'major-08').stories, [older]);
  assert.equal(cardId({ id: 'cups-01', number: '01' }), 'cups-01');
  assert.notEqual(cardId({ id: 'cups-01' }), cardId({ number: '01' }));
});

test('選択結果は新しい順に重複なく並び、三枚と選択カードを表示する', () => {
  const { byCards, index, byDate } = renderIndexes([older, newer]);
  const result = byCards.split('id="major-08"')[1].split('</section>')[0];
  assert.ok(result.indexOf('新しい物語') < result.indexOf('古い物語'));
  assert.equal((result.match(/href="stories\/2026-10-24\/"/g) || []).length, 1);
  assert.match(result, /現在：力（逆位置）/);
  assert.match(result, /未来：力の表記揺れ（逆位置）/);
  assert.equal((result.match(/class="selected-card"/g) || []).length, 3);
  assert.match(byCards, /href="#major-08"/);
  assert.match(byCards, /2作品/);
  assert.doesNotMatch(index + byDate + byCards, /archive-title|題名から/);
  assert.doesNotMatch(index, /はじめて読む方へ/);
});

test('おすすめは選定済みの3〜5作品だけを掲載する', () => {
  const third = { ...newer, date: '2026-10-26', path: 'stories/2026-10-26/', title: '三作目' };
  const stories = [older, newer, third];
  assert.match(renderIndexes(stories, stories.map(s => s.path)).index, /はじめて読む方へ/);
  assert.throws(() => renderIndexes(stories, [older.path]));
  assert.throws(() => renderIndexes(stories, [older.path, newer.path, 'stories/missing/']));
});
