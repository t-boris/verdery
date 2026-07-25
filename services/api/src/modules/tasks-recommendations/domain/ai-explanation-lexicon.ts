/**
 * Bilingual (en/ru) lexicons behind the AI-explanation validation
 * (P7-AI-01): the ACTION-CONCEPT lexicon that makes "Introduces an
 * unsupported action" (section 9) decidable deterministically, and the
 * PROHIBITED-CONTENT lexicon that makes "Contradicts safety filters" /
 * "Contains prohibited content" structural for section 13's excluded
 * categories (`EXCLUDED_RULE_CONTENT_CATEGORIES`'s subjects, spelled as
 * words in both product languages).
 *
 * HOW MATCHING WORKS: a term set carries word-PREFIX stems (matching any
 * word starting with the stem — how both languages inflect: water →
 * watering, полив → поливать) and EXACT word forms (for short words a
 * prefix would over-match: `law` would match "lawn", `яд` would match
 * "ядро", so those are enumerated exactly). Matching is case-insensitive
 * over Unicode word boundaries.
 *
 * THE DELIBERATE BIAS — over-reject, never under-reject: a false match
 * (say the genitive "полей" of "поле" read as the imperative of
 * "полить") rejects a harmless embellishment, and rejection falls back
 * to the deterministic explanation, which is always correct. The
 * opposite error — an unsupported action slipping through — is the
 * phase's exit criterion violated. Every ambiguity below is therefore
 * resolved toward matching. What lexicons cannot catch (number words
 * like "two liters", novel phrasing of an action no concept lists) is
 * named honestly in `tests/ai-explanation-fixtures/README.md` as what
 * the section-16 human evaluation pass adds on top.
 *
 * Widening or narrowing EITHER lexicon is a reviewed edit to this file —
 * the `EXCLUDED_RULE_CONTENT_CATEGORIES` posture — and the fixture suite
 * pins the behavior per entry.
 *
 * Source: architecture/recommendations-and-ai.md, sections "9.
 * Structured Output" and "13. Safety Tiers"; implementation-plan.md
 * Phase 7 exit criterion "Generated text cannot add unsupported actions
 * or bypass safety filters".
 */

/** One language's terms: `stems` match any word starting with the stem; `words` match exactly. */
export interface TermSet {
  readonly stems: readonly string[];
  readonly words: readonly string[];
}

export interface BilingualTerms {
  readonly en: TermSet;
  readonly ru: TermSet;
}

export interface ActionConcept extends BilingualTerms {
  /** Stable id, asserted by fixtures and carried in rejection details. */
  readonly id: string;
}

/**
 * Care actions the model could name. A concept is PERMITTED in an
 * embellishment only when the candidate's own deterministic baseline
 * (explanation + action title) contains it — the baseline is the action
 * vocabulary, exactly as the phase exit criterion requires. The launch
 * baselines' own vocabulary: checking (all four rules), watering
 * (`watering.dry-spell-check`), harvesting
 * (`lifecycle.harvest-readiness-check`), covering/protection
 * (`weather.frost-watch`).
 */
export const ACTION_CONCEPTS: readonly ActionConcept[] = [
  {
    id: 'checking',
    en: { stems: ['check', 'inspect', 'monitor', 'observ', 'record'], words: [] },
    ru: { stems: ['провер', 'осмотр', 'осматр', 'наблюд', 'запис', 'запиш'], words: [] },
  },
  {
    id: 'watering',
    en: { stems: ['water', 'irrigat', 'moistur'], words: [] },
    ru: { stems: ['полив', 'полей', 'полит', 'орош', 'увлажн'], words: [] },
  },
  {
    id: 'harvesting',
    en: { stems: ['harvest', 'ripe'], words: ['pick', 'picks', 'picking', 'picked'] },
    ru: {
      stems: ['урожа', 'собер', 'собир', 'спел', 'созре', 'дозре'],
      words: ['сбор', 'сбора', 'сбору', 'сбором', 'сборе'],
    },
  },
  {
    id: 'covering_protection',
    en: { stems: ['cover', 'protect', 'shelter', 'shield', 'fleece', 'wrap'], words: [] },
    ru: { stems: ['укры', 'укро', 'накр', 'защит', 'защищ', 'утепл'], words: [] },
  },
  {
    id: 'pruning',
    en: { stems: ['prun', 'trim', 'deadhead'], words: ['cut', 'cuts', 'cutting'] },
    ru: { stems: ['обрез', 'обреж', 'подрез', 'стриг', 'стриж', 'прищип'], words: [] },
  },
  {
    id: 'fertilizing',
    en: {
      stems: ['fertiliz', 'fertilis', 'compost', 'mulch'],
      words: ['feed', 'feeds', 'feeding', 'fed'],
    },
    ru: { stems: ['удобр', 'подкорм', 'подкарм', 'компост', 'мульч'], words: [] },
  },
  {
    id: 'spraying_treatment',
    en: { stems: ['spray', 'treat', 'apply', 'appli'], words: [] },
    ru: { stems: ['опрыск', 'обработ', 'обрабат', 'примен'], words: [] },
  },
  {
    id: 'repotting_transplanting',
    en: { stems: ['repot', 'transplant', 'replant'], words: [] },
    ru: { stems: ['пересад', 'пересаж', 'перевал'], words: [] },
  },
  {
    id: 'removal',
    en: { stems: ['remov', 'discard', 'uproot'], words: ['dig', 'digs', 'digging', 'dug'] },
    ru: { stems: ['удал', 'выкоп', 'выкап', 'выдерн', 'выброс', 'выбрас'], words: [] },
  },
  {
    id: 'moving',
    en: { stems: ['relocat'], words: ['move', 'moves', 'moving', 'moved'] },
    ru: { stems: ['перемест', 'перемещ', 'перенес', 'перенос', 'передвин'], words: [] },
  },
];

export interface ProhibitedCategory extends BilingualTerms {
  /** Mirrors `EXCLUDED_RULE_CONTENT_CATEGORIES` spellings where one exists. */
  readonly id: string;
}

/**
 * Section 13's excluded subjects as words. NEVER permitted, regardless
 * of what a baseline says — no launch rule can declare these categories
 * (`validateRuleDefinition` rejects them), so no baseline can legitimize
 * the vocabulary, and this list refuses it even if one somehow did.
 */
export const PROHIBITED_CATEGORIES: readonly ProhibitedCategory[] = [
  {
    id: 'chemical_application',
    en: {
      stems: ['chemical', 'pesticid', 'herbicid', 'fungicid', 'insecticid', 'glyphosate'],
      words: [],
    },
    ru: {
      stems: ['химич', 'химикат', 'пестицид', 'гербицид', 'фунгицид', 'инсектицид'],
      words: [],
    },
  },
  {
    id: 'fertilizer_concentration',
    en: {
      stems: ['dos', 'dilut', 'concentrat'],
      words: ['ppm', 'mg', 'ml'],
    },
    ru: {
      stems: ['дозир', 'развед', 'разбав', 'концентрац', 'концентрир'],
      words: ['доза', 'дозы', 'дозе', 'дозу', 'дозой', 'дозах', 'мг', 'мл'],
    },
  },
  {
    id: 'medical',
    en: {
      stems: ['medic', 'poison', 'toxic', 'antidote', 'ingest'],
      words: [],
    },
    ru: {
      stems: ['медицин', 'лекарств', 'отрав', 'токсич', 'ядовит', 'ядохимикат'],
      words: ['яд', 'яда', 'яду', 'ядом', 'яде', 'яды'],
    },
  },
  {
    id: 'emergency',
    en: { stems: ['emergen'], words: [] },
    ru: { stems: ['экстренн', 'чрезвычайн'], words: ['скорую', 'скорая'] },
  },
  {
    id: 'disease_diagnosis',
    en: {
      stems: ['disease', 'diagnos', 'infect', 'blight', 'mildew', 'fungus', 'fungal'],
      words: ['rot', 'rots', 'rotten', 'rotting'],
    },
    ru: {
      stems: [
        'болезн',
        'заболе',
        'диагно',
        'инфекц',
        'грибок',
        'грибков',
        'плесен',
        'фитофтор',
        'мучнист',
        'гнил',
      ],
      words: [],
    },
  },
  {
    id: 'pest_treatment',
    en: {
      stems: ['pest', 'aphid', 'slug', 'caterpillar'],
      words: ['mite', 'mites'],
    },
    ru: {
      stems: ['вредител', 'гусениц', 'слизн'],
      words: ['тля', 'тли', 'тлей', 'тлю', 'клещ', 'клещи', 'клещей'],
    },
  },
  {
    id: 'structural',
    en: { stems: ['structural', 'foundation'], words: [] },
    ru: { stems: ['несущ', 'фундамент'], words: [] },
  },
  {
    id: 'electrical',
    en: { stems: ['electric', 'wiring', 'voltage'], words: [] },
    ru: { stems: ['электр', 'проводк', 'напряжен'], words: [] },
  },
  {
    id: 'legal_boundary',
    en: { stems: ['legal', 'lawsuit', 'boundary'], words: ['law', 'laws'] },
    ru: { stems: ['юридич', 'судебн', 'межев', 'законодат'], words: [] },
  },
];

const patternCache = new Map<TermSet, RegExp | null>();

function escapeForRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** One compiled matcher per term set: word-start stems consume the rest of the word; exact words require a boundary on both sides. */
function compile(set: TermSet): RegExp | null {
  const cached = patternCache.get(set);
  if (cached !== undefined) {
    return cached;
  }
  const alternatives: string[] = [];
  if (set.stems.length > 0) {
    alternatives.push(`(?:${set.stems.map(escapeForRegex).join('|')})\\p{L}*`);
  }
  if (set.words.length > 0) {
    alternatives.push(`(?:${set.words.map(escapeForRegex).join('|')})(?=$|\\P{L})`);
  }
  const compiled =
    alternatives.length === 0
      ? null
      : new RegExp(`(?<=^|\\P{L})(?:${alternatives.join('|')})`, 'iu');
  patternCache.set(set, compiled);
  return compiled;
}

function matches(text: string, terms: BilingualTerms): boolean {
  const en = compile(terms.en);
  const ru = compile(terms.ru);
  return (en !== null && en.test(text)) || (ru !== null && ru.test(text));
}

/**
 * Every action concept the text names, scanned in BOTH languages
 * regardless of the text's own locale — an English baseline must permit
 * a Russian embellishment's "полив" through the shared `watering`
 * concept, and a mixed-language injection must not evade either scan.
 */
export function scanActionConcepts(text: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const concept of ACTION_CONCEPTS) {
    if (matches(text, concept)) {
      found.add(concept.id);
    }
  }
  return found;
}

/** The first prohibited category the text names, in either language, or `null`. */
export function findProhibitedCategory(text: string): string | null {
  for (const category of PROHIBITED_CATEGORIES) {
    if (matches(text, category)) {
      return category.id;
    }
  }
  return null;
}
