/**
 * English messages for the seasonal-timing acceptance queue.
 *
 * The copy has to carry a distinction the product depends on and nothing
 * else states: accepting is "use this timing in MY garden", not "this
 * content is correct". Timing is shared between gardens, and one gardener
 * cannot vouch for it on everyone's behalf — so the sentence a person reads
 * before pressing the button describes the scope of what they are deciding.
 *
 * The window labels are NOT redefined here. They are the same
 * `seasonalPlan.calendar.*` keys the seasonal plan renders, so the months a
 * person accepts are worded exactly as they will read them afterwards.
 */
export const englishSeasonalAcceptanceMessages = {
  'seasonalAcceptance.title': 'Seasonal timing to accept',
  'seasonalAcceptance.description':
    'Sowing, transplanting and harvest months for the plants you grow. They are shared between gardens, so nothing here is used for your garden until you accept it. Accepting switches on the sowing-window, succession and rotation checks for this garden only.',
  'seasonalAcceptance.loading': 'Loading seasonal timing.',
  'seasonalAcceptance.retry': 'Try again',
  'seasonalAcceptance.accept': 'Use in this garden',
  'seasonalAcceptance.awaitingReview': 'Not reviewed by a horticulturist',
  'seasonalAcceptance.source': 'Source: {source}',
  'seasonalAcceptance.noWindowsConfigured': 'This entry configures no months.',
  'seasonalAcceptance.empty':
    'Nothing left to decide. Seasonal timing for every plant you grow has been accepted.',

  'seasonalAcceptance.hemisphereUnknownTitle': 'This garden has no location yet',
  'seasonalAcceptance.hemisphereUnknownDescription':
    'Sowing months are opposite in the two halves of the world, so there is nothing to decide until this garden is located.',
  'seasonalAcceptance.setLocation': 'Set the location',

  'seasonalAcceptance.notAcceptableTitle': 'Nothing to accept there',
  'seasonalAcceptance.notAcceptableDescription':
    'That timing is not available for this garden. It may have been accepted already, or it may belong to the other hemisphere.',
} as const;
