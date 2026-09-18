// lib/restricted.js
/**
 * Alcohol and tobacco on a bill.
 *
 * A bill that includes either is never attached to a charge or sent to
 * accounts, even when it is the right bill for the charge: the charge is
 * marked "no bill exists" instead. Checked on item names and on the HSN code
 * Indian tax invoices print for each line (tobacco 2401-2404, alcohol
 * 2203-2208), which catches a brand name the word list does not know.
 * Pure: returns the terms that matched, empty when the bill is fine.
 */

// Removed before matching, so a soft drink named after a drink is not flagged.
const SAFE = /\b((non[- ]?alcoholic|alcohol[- ]?free|zero[- ]alcohol)(\s+\w+)?|0\.0\s*%?|virgin\s+\w+|ginger\s+(ale|beer)|root\s+beer|mocktails?)\b/gi;

const TERMS = [
  "cigarettes?", "cigars?", "cigarillos?", "tobacco", "beedis?", "bidis?", "gutkha", "zarda", "khaini", "hookah", "shisha", "vapes?", "e-?cig\\w*", "nicotine",
  "alcohol\\w*", "liquor", "beers?", "wines?", "whisk(?:e)?y", "whiskies", "vodka", "rum", "gin", "tequila", "brandy", "cognac", "champagne", "prosecco",
  "cocktails?", "lager", "ales?", "ipa", "stout", "cider", "sake", "sangria", "breezer", "shots?\\s+of",
  "heineken", "budweiser", "tuborg", "carlsberg", "hoegaarden", "bira", "smirnoff", "absolut", "jameson", "old\\s+monk", "jack\\s+daniel'?s", "johnnie\\s+walker", "bacardi",
  "marlboro", "gold\\s+flake", "navy\\s+cut", "benson\\s*(?:&|and)\\s*hedges", "dunhill",
];
const WORDS = new RegExp(`\\b(${TERMS.join("|")})\\b`, "gi");

// A full 8-digit HSN code in a restricted chapter. Shorter forms collide with
// prices (2205.00) and order numbers, and the word list covers those bills.
const HSN = /\b(220[3-8]|240[1-4])\d{4}\b/g;

export function restrictedGoods({ text = "", items = [] } = {}) {
  const body = [text, ...(items || []).map((i) => i?.desc || i?.description || "")].join("\n").replace(SAFE, " ");
  const hits = new Set();
  for (const m of body.matchAll(WORDS)) hits.add(m[1].toLowerCase().replace(/s$/, "").replace(/\s+/g, " "));
  for (const m of body.matchAll(HSN)) hits.add(`HSN ${m[0]}`);
  return [...hits];
}
