const wholeCrownsFormatter = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
});
const crownsAndHalereFormatter = new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Haléře as Czech crowns, e.g. 4500 → "45 Kč", 4550 → "45,50 Kč". */
export const formatPrice = (halere: number): string =>
    (halere % 100 === 0 ? wholeCrownsFormatter : crownsAndHalereFormatter).format(halere / 100);

/** Haléře as an editable amount in crowns, e.g. 4500 → "45", 4550 → "45,50". */
export const formatCrownsInput = (halere: number): string => {
    const crowns = Math.trunc(halere / 100);
    const fraction = halere % 100;
    return fraction === 0 ? String(crowns) : `${crowns},${String(fraction).padStart(2, '0')}`;
};
