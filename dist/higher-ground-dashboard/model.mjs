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

export function formatValue(value, format = 'number', compact = false) {
  const options = {maximumFractionDigits: 2};
  if (compact && Math.abs(value) >= 1000000) options.notation = 'compact';
  if (format === 'dollars') Object.assign(options, {style: 'currency', currency: 'USD'});
  const number = new Intl.NumberFormat('en-US', options).format(value);
  return format === 'percent' ? number + '%' : number;
}
export function formatChange(value, format = 'number') {
  const prefix = value > 0 ? '+' : '';
  return prefix + (format === 'percent' ? formatValue(value) + ' pp' : formatValue(value, format));
}
export function discSegments(card) {
  const ratio = Math.max(0, card.current) / card.goal;
  return {
    blue: Math.min(1, ratio),
    red: Math.max(0, 1 - ratio),
    green: Math.max(0, Math.min(1, ratio - 1)),
  };
}
export function targetDistance(card) {
  const amount = Math.abs(card.goal - card.current);
  const value = card.format === 'percent' ? formatValue(amount) + ' pp' : formatValue(amount, card.format);
  return {amount, value, label: card.current > card.goal ? 'over target' : 'remaining', reached: card.current >= card.goal};
}
