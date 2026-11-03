export function progress(card) {
  const ratio = card.current / card.goal;
  return {
    percentage: ratio * 100,
    arc: Math.max(0, Math.min(1, ratio)),
    overage: Math.max(0, Math.min(1, ratio - 1)),
    exceeded: ratio > 1,
    reached: ratio >= 1,
    delta: card.previous == null ? null : card.current - card.previous,
  };
}
export function orderedCards(cards, category = '*') {
  return cards.filter(card => category === '*' || card.category === category).toSorted((a, b) =>
    Number(a.current >= a.goal) - Number(b.current >= b.goal)
    || a.category.localeCompare(b.category)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id));
}
