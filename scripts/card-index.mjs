// Existing records use major arcana numbers. Future decks can provide a stable,
// deck-qualified id (for example, "cups-01") and an optional image path.
export function cardId(card) {
  if (card.id) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(card.id)) throw new Error(`不正なカードID: ${card.id}`);
    return card.id;
  }
  const number = String(card.number ?? '').normalize('NFKC');
  if (!/^\d{1,2}$/.test(number) || Number(number) > 21) throw new Error(`不正な大アルカナ番号: ${card.number}`);
  return `major-${number.padStart(2, '0')}`;
}

// Counts are per story, independent of repeated cards, position and orientation.
// The optional filters let a future UI reuse the same index without changing data.
export function collectCards(stories, { position, orientation } = {}) {
  const cards = new Map();
  for (const story of stories) {
    const seen = new Set();
    for (const card of story.cards) {
      if (position && card.position !== position || orientation && card.orientation !== orientation) continue;
      const id = cardId(card);
      if (!cards.has(id)) cards.set(id, { id, name: card.name, image: card.image ?? (id.startsWith('major-') ? `assets/tarot/${id.slice(6)}.svg` : null), stories: [] });
      if (!seen.has(id)) cards.get(id).stories.push(story);
      seen.add(id);
    }
  }
  return [...cards.values()].sort((a, b) => a.id.localeCompare(b.id));
}
