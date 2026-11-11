import corpus from "../knowledge/guides.json";

export const normalize = (value: string) => value.toLowerCase().normalize("NFD")
  .replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/\b(?:dki|dk|dang ki)\b/g, "dang ky")
  .replace(/[^a-z0-9]+/g, " ").trim();

const ignored = new Set(["toi", "em", "ban", "minh", "co", "cho", "va", "da", "duoc", "khong", "the", "nao", "bi", "sao", "gi"]);
const indexedGuides = corpus.guides.map(guide => {
  const phrases = guide.aliases.map(normalize);
  return {
    guide, phrases,
    codes: guide.codes.map(normalize),
    tokens: new Set(phrases.join(" ").split(" ").filter(word => !ignored.has(word))),
  };
});

export function retrieveGuides(question: string, noticeCode?: string) {
  const normalized = ` ${normalize(question)} `;
  const words = new Set(normalized.trim().split(" "));
  return indexedGuides.map(({ guide, phrases, codes, tokens }) => {
    if (noticeCode && guide.codes.includes(noticeCode)) return { guide, score: 200 };
    if (codes.some(code => normalized.includes(` ${code} `))) return { guide, score: 100 };
    const overlap = [...tokens].filter(word => words.has(word)).length;
    const matches = phrases.filter(phrase => normalized.includes(` ${phrase} `));
    const leading = matches.some(phrase => normalized.startsWith(` ${phrase} `));
    const score = matches.length * 6 + (leading ? 3 : 0) + (overlap >= 2 ? overlap : 0);
    return { guide, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 3).map(item => item.guide);
}
