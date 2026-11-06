const widths = [24, 30, 36, 48, 60, 72];
const rollRates = (prefix, rates) => widths.map((width, index) =>
  [prefix + width, width + ' in ($/ft)', rates[index]]);
export const addOns = [
  ['ptfr', 'Frame (ft)', 1.5], ['ptco', 'Corners', 0.5], ['pttk', 'Tilt Keys', 0.75],
  ['ptkl', 'Knife Latches', 1.75], ['ptpp', 'Push Pins', 0.5], ['ptts', 'Tension Springs', 0.75],
  ['ptcc', 'Corner Clips', 0.5], ['ptpt', 'Pull Tabs', 0.5], ['ptsb', 'Slide Bolts', 3.5],
  ['ptsdwh', 'Screen Door Wheels', 4.5], ['ptsc', 'Special Corners', 2.5]
];
export const rateGroups = [
  ['Fiberglass screen', rollRates('fb', [1.5, 1.75, 2, 2.5, 3, 3.5])],
  ['Aluminum screen', rollRates('al', [2, 2.25, 2.5, 3, 3.5, 4])],
  ['Pet screen', rollRates('pet', [3.75, 3.75, 4.25, 4.25, 4.25, 4.25])],
  ['Glass and spline', [['glass', 'Glass ($/sq in)', 0.035], ['spline', 'Spline ($/ft)', 0.24]]],
  ['Labor ($/in of perimeter)', [['wlsc', 'Aluminum frame', 0.15], ['wlwd', 'Wood frame', 0.2], ['wlw', 'Glass', 0.2]]],
  ['Add-ons ($/unit)', addOns]
];
export const defaultRates = Object.fromEntries(rateGroups.flatMap(([, rates]) =>
  rates.map(([key, , rate]) => [key, rate])));
const screenMaterials = {
  fiberglass: ['fb', 'Fiberglass Screen Material'],
  aluminum: ['al', 'Aluminum Screen Material'],
  pet: ['pet', 'Pet Screen Material']
};

export function estimate({item, width, length, material, frame, quantities}, rates) {
  const materials = [];
  const labor = [];
  const perimeter = (length + width) * 2;
  if (width > 0 && length > 0) {
    if (item === 'glass') {
      materials.push(['Glass', width * length * rates.glass]);
      labor.push(['Glass Installation', perimeter * rates.wlw]);
    } else {
      const [prefix, label] = screenMaterials[material];
      const roll = widths.find(size => width <= size);
      materials.push([label, (length / 12) * rates[prefix + roll]], ['Spline', (perimeter / 12) * rates.spline]);
      labor.push(frame === 'wood'
        ? ['Wood Frame Installation', perimeter * rates.wlwd]
        : ['Aluminum Frame Installation', perimeter * rates.wlsc]);
    }
  }
  for (const [key, label] of addOns) {
    const quantity = quantities[key];
    if (quantity > 0) materials.push([label + ' (×' + quantity + ')', quantity * rates[key]]);
  }
  const rounded = lines => Math.round(lines.reduce((sum, [, cost]) => sum + cost, 0));
  return {labor: rounded(labor), materials: rounded(materials), lines: [...materials, ...labor]};
}
