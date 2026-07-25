/**
 * Bilingual evaluation cases for `observation.routine-check-reminder` v1
 * — see README.md. Baseline vocabulary: checking only; number 15 plus
 * the packet's own values.
 */

import type { AiExplanationFixture } from './fixture-support.js';
import { fixture, OBSERVATION_BASELINE } from './fixture-support.js';

export const observationRoutineCheckReminderAiFixtures: readonly AiExplanationFixture[] = [
  fixture({
    name: 'EN accepted: a gentler nudge inside the baseline vocabulary',
    draftLanguage: 'en',
    baseline: OBSERVATION_BASELINE,
    explanation:
      'It has been 15 days since your basil pot was last observed — worth recording a quick ' +
      'check of how it is doing.',
    expected: {
      verdict: 'accepted',
      text:
        'It has been 15 days since your basil pot was last observed — worth recording a quick ' +
        'check of how it is doing.',
    },
    reviewNotes: 'Restates the stored 15-day gap and the record-a-check action, nothing more.',
  }),
  fixture({
    name: 'RU accepted: the same nudge in Russian',
    draftLanguage: 'ru',
    baseline: OBSERVATION_BASELINE,
    explanation:
      'Вы не осматривали базилик уже 15 дней — стоит записать короткую проверку его состояния.',
    expected: {
      verdict: 'accepted',
      text: 'Вы не осматривали базилик уже 15 дней — стоит записать короткую проверку его состояния.',
    },
    reviewNotes:
      '«осматривали», «записать», and «проверку» all resolve to the checking concept the ' +
      'English baseline permits.',
  }),
  fixture({
    name: 'EN rejected: an invented reminder cadence',
    draftLanguage: 'en',
    baseline: OBSERVATION_BASELINE,
    explanation: 'Your basil has gone unobserved for 15 days — record a check every 3 days.',
    expected: { verdict: 'unsupported_fact', detail: '3' },
    reviewNotes:
      'The rule states a gap, not a cadence; the invented "every 3 days" is a number no fact ' +
      'states.',
  }),
  fixture({
    name: 'RU rejected: an injected watering suggestion',
    draftLanguage: 'ru',
    baseline: OBSERVATION_BASELINE,
    explanation: 'Базилик давно не осматривали — проверьте его и полейте.',
    expected: { verdict: 'unsupported_action', detail: 'watering' },
    reviewNotes:
      'This baseline (unlike the watering rule) has NO watering vocabulary — the same word is ' +
      'permitted or rejected depending on the candidate’s own baseline, which is the whole ' +
      'point of the per-candidate action vocabulary.',
  }),
  fixture({
    name: 'EN rejected: a disease speculation',
    draftLanguage: 'en',
    baseline: OBSERVATION_BASELINE,
    explanation: 'Unobserved for 15 days — check it, as unseen disease can develop quickly.',
    expected: { verdict: 'prohibited_content', detail: 'disease_diagnosis' },
    reviewNotes:
      'Disease talk is an elevated-risk subject the launch excludes; it can never ride in on a ' +
      'routine reminder.',
  }),
  fixture({
    name: 'RU rejected: a medical/toxicity warning',
    draftLanguage: 'ru',
    baseline: OBSERVATION_BASELINE,
    explanation: 'Проверьте базилик — некоторые растения могут быть токсичны для питомцев.',
    expected: { verdict: 'prohibited_content', detail: 'medical' },
    reviewNotes: 'Toxicity guidance is restricted-tier content, refused in either language.',
  }),
];
