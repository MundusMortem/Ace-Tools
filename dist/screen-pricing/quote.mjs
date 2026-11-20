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
export const defaultSettings = {rates: defaultRates, adjustment: 0, roundUp: true, bulkLaborDiscount: 10, revision: 0};
const screenMaterials = {fiberglass: 'fb', aluminum: 'al', pet: 'pet'};

export function estimate({item, width, length, material, frame, quantities, bulkPricing}, settings) {
  const {rates, adjustment, roundUp, bulkLaborDiscount} = settings;
  let materials = 0;
  let labor = 0;
  const perimeter = (length + width) * 2;
  if (width > 0 && length > 0) {
    if (item === 'glass') {
      materials = width * length * rates.glass;
      labor = perimeter * rates.wlw;
    } else {
      const roll = widths.find(size => width <= size);
      materials = (length / 12) * rates[screenMaterials[material] + roll] + (perimeter / 12) * rates.spline;
      labor = perimeter * (frame === 'wood' ? rates.wlwd : rates.wlsc);
    }
  }
  for (const [key] of addOns) {
    const quantity = quantities[key];
    if (quantity > 0) materials += quantity * rates[key];
  }

  if (bulkPricing) labor *= 1 - bulkLaborDiscount / 100;
  const total = (materials + labor) * (1 + adjustment / 100);
  // Keep floating-point noise at exact dollar boundaries from adding a dollar.
  const nearestDollar = Math.round(total);
  if (Math.abs(total - nearestDollar) <= Number.EPSILON * nearestDollar) return nearestDollar;
  return roundUp ? Math.ceil(total) : total;
}
