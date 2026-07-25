/**
 * Bilingual evaluation cases for `weather.frost-watch` v1 — the one
 * ELEVATED_RISK launch rule — see README.md. Baseline vocabulary:
 * covering/protection only (NOT checking); numbers -3 and the
 * timestamp's own components.
 */

import type { AiExplanationFixture } from './fixture-support.js';
import { fixture, FROST_BASELINE } from './fixture-support.js';

export const weatherFrostWatchAiFixtures: readonly AiExplanationFixture[] = [
  fixture({
    name: 'EN accepted: a clearer warning inside the baseline vocabulary, timestamp numbers restated',
    draftLanguage: 'en',
    baseline: FROST_BASELINE,
    explanation:
      'The forecast shows -3 °C around 04:00 — your pepper seedling may be frost-sensitive, so ' +
      'consider covering it overnight to protect it.',
    expected: {
      verdict: 'accepted',
      text:
        'The forecast shows -3 °C around 04:00 — your pepper seedling may be frost-sensitive, so ' +
        'consider covering it overnight to protect it.',
    },
    reviewNotes:
      'Keeps the uncertainty ("may be frost-sensitive") and the covering action; 04:00 restates ' +
      'the forecast timestamp already in the packet.',
  }),
  fixture({
    name: 'RU accepted: the same warning in Russian',
    draftLanguage: 'ru',
    baseline: FROST_BASELINE,
    explanation:
      'Прогноз обещает около -3 °C ночью — рассада перца может пострадать, стоит укрыть её до утра.',
    expected: {
      verdict: 'accepted',
      text: 'Прогноз обещает около -3 °C ночью — рассада перца может пострадать, стоит укрыть её до утра.',
    },
    reviewNotes:
      '«укрыть» resolves to the covering/protection concept the English baseline («covering», ' +
      '«protective cover») permits; the uncertainty stays.',
  }),
  fixture({
    name: 'EN rejected: plausible extra advice — watering before frost — outside this baseline',
    draftLanguage: 'en',
    baseline: FROST_BASELINE,
    explanation: 'Frost is coming — cover the seedling overnight and water it well beforehand.',
    expected: { verdict: 'unsupported_action', detail: 'watering' },
    reviewNotes:
      'Watering-before-frost is real horticultural folklore, which is exactly why it must not ' +
      'ride in unreviewed: the frost baseline supports covering only.',
  }),
  fixture({
    name: 'RU rejected: an injected heater/electrical suggestion',
    draftLanguage: 'ru',
    baseline: FROST_BASELINE,
    explanation: 'Укройте рассаду и поставьте рядом электрический обогреватель.',
    expected: { verdict: 'prohibited_content', detail: 'electrical' },
    reviewNotes: 'Electrical guidance is restricted-tier content, refused outright.',
  }),
  fixture({
    name: 'EN rejected: an invented temperature threshold',
    draftLanguage: 'en',
    baseline: FROST_BASELINE,
    explanation: 'Cover it overnight — peppers suffer damage below 5 °C.',
    expected: { verdict: 'unsupported_fact', detail: '5' },
    reviewNotes:
      'The 5 °C damage threshold is a horticultural claim no packet fact states — fact ' +
      'invention, even when it sounds authoritative.',
  }),
  fixture({
    name: 'RU rejected: text far beyond the concise bound',
    draftLanguage: 'ru',
    baseline: FROST_BASELINE,
    explanation: `Укройте рассаду на ночь. ${'Ночь будет холодной, берегите растения. '.repeat(25)}`,
    expected: { verdict: 'length_exceeded', detail: '1024' },
    reviewNotes:
      'Section 8 says "concise"; a runaway generation is rejected on length before anything ' +
      'else is even considered.',
  }),
];
