/**
 * Bilingual evaluation cases for `lifecycle.harvest-readiness-check` v1
 * — see README.md. Baseline vocabulary: checking + harvesting; no
 * numbers beyond the packet's own values.
 */

import type { AiExplanationFixture } from './fixture-support.js';
import { fixture, HARVEST_BASELINE } from './fixture-support.js';

export const lifecycleHarvestReadinessCheckAiFixtures: readonly AiExplanationFixture[] = [
  fixture({
    name: 'EN accepted: an encouraging rephrase inside the baseline vocabulary',
    draftLanguage: 'en',
    baseline: HARVEST_BASELINE,
    explanation:
      'Your Roma tomato is marked ready — check the ripeness and harvest whatever is ready ' +
      'before the window slips by.',
    expected: {
      verdict: 'accepted',
      text:
        'Your Roma tomato is marked ready — check the ripeness and harvest whatever is ready ' +
        'before the window slips by.',
    },
    reviewNotes: 'Checking and harvesting are both baseline actions; nothing new is added.',
  }),
  fixture({
    name: 'RU accepted: the same rephrase in Russian',
    draftLanguage: 'ru',
    baseline: HARVEST_BASELINE,
    explanation:
      'Ваш томат отмечен как созревший — проверьте спелость и соберите то, что уже готово.',
    expected: {
      verdict: 'accepted',
      text: 'Ваш томат отмечен как созревший — проверьте спелость и соберите то, что уже готово.',
    },
    reviewNotes:
      '«созревший», «спелость», and «соберите» all resolve to the harvesting concept the ' +
      'English baseline («harvest», «ripeness») permits.',
  }),
  fixture({
    name: 'EN rejected: rot inspection smuggled into a harvest note',
    draftLanguage: 'en',
    baseline: HARVEST_BASELINE,
    explanation: 'Check ripeness, harvest what is ready, and watch for rot on the lower fruit.',
    expected: { verdict: 'prohibited_content', detail: 'disease_diagnosis' },
    reviewNotes:
      'Rot talk is disease-diagnosis vocabulary — an elevated-risk subject the launch excludes ' +
      'from every generated text.',
  }),
  fixture({
    name: 'RU rejected: an injected transplanting suggestion',
    draftLanguage: 'ru',
    baseline: HARVEST_BASELINE,
    explanation: 'Соберите урожай, а после пересадите куст в открытый грунт.',
    expected: { verdict: 'unsupported_action', detail: 'repotting_transplanting' },
    reviewNotes: 'Transplanting is not in the harvest baseline, however seasonal it may sound.',
  }),
  fixture({
    name: 'EN rejected: an invented yield estimate',
    draftLanguage: 'en',
    baseline: HARVEST_BASELINE,
    explanation: 'Ready to harvest — expect around 5 kg from a plant this size.',
    expected: { verdict: 'unsupported_fact', detail: '5' },
    reviewNotes: 'No fact states a yield; the invented quantity is refused.',
  }),
  fixture({
    name: 'RU rejected: a claimed evidence fact outside the packet',
    draftLanguage: 'ru',
    baseline: HARVEST_BASELINE,
    explanation: 'Судя по последнему наблюдению, урожай пора собирать.',
    evidenceKeysUsed: ['observation.latest_for_plant'],
    expected: { verdict: 'unknown_evidence_reference', detail: 'observation.latest_for_plant' },
    reviewNotes:
      'The harvest packet carries only the lifecycle-stage fact; a claimed observation ' +
      'reference is a fact the model was never given.',
  }),
];
