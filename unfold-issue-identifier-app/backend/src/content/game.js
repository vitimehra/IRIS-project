/**
 * Game content for the Day Reconstruction Board and the Saboteur.
 *
 * All scene selection is rule-based. The instrument therefore runs identically
 * with the language model switched off, and every participant meets the same
 * stimuli — which is what makes the responses comparable in analysis.
 */

export const GAME_CONTENT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Emotion tokens
// ---------------------------------------------------------------------------
// Friction-shaped rather than a happiness scale. The eight negative tokens are
// what the Saboteur fires on; the two positive ones exist so that tagging a
// good moment is a real option and the board does not read as a complaint form.

export const EMOTION_TOKENS = [
  { key: 'rushed', label: 'Rushed', negative: true, hint: 'Not enough time for it' },
  { key: 'waiting', label: 'Waiting', negative: true, hint: 'Stuck waiting on something or someone' },
  { key: 'stuck', label: 'Stuck', negative: true, hint: 'Could not get it to work' },
  { key: 'repeating', label: 'Repeating myself', negative: true, hint: 'Had to do or say it again' },
  { key: 'cleaning_up', label: 'Cleaning up after', negative: true, hint: 'Undoing someone else’s mess' },
  { key: 'interrupted', label: 'Interrupted', negative: true, hint: 'Kept getting pulled away' },
  { key: 'confused', label: 'Confused', negative: true, hint: 'Not sure what to do next' },
  { key: 'put_off', label: 'Put off', negative: true, hint: 'Avoided it, or pushed it later' },
  { key: 'fine', label: 'Fine', negative: false, hint: 'Went as expected' },
  { key: 'good', label: 'Good', negative: false, hint: 'Actually enjoyed it' },
];

export const NEGATIVE_TOKENS = EMOTION_TOKENS.filter((t) => t.negative).map((t) => t.key);

export const TIME_BANDS = [
  { key: 'dawn', label: 'Early morning', window: '5am – 7am' },
  { key: 'morning', label: 'Morning', window: '7am – 11am' },
  { key: 'midday', label: 'Midday', window: '11am – 3pm' },
  { key: 'afternoon', label: 'Afternoon', window: '3pm – 6pm' },
  { key: 'evening', label: 'Evening', window: '6pm – 10pm' },
  { key: 'night', label: 'Night', window: '10pm – 5am' },
];

export const DOMAINS = [
  { key: 'morning_routine', label: 'Getting ready' },
  { key: 'food', label: 'Food and cooking' },
  { key: 'health', label: 'Health and body' },
  { key: 'chores', label: 'Cleaning and chores' },
  { key: 'commute', label: 'Getting around' },
  { key: 'work_study', label: 'Work or study' },
  { key: 'money_shopping', label: 'Money and shopping' },
  { key: 'family_care', label: 'Family and looking after people' },
  { key: 'devices', label: 'Phone and computer' },
  { key: 'admin', label: 'Bills, banking and paperwork' },
  { key: 'evening_sleep', label: 'Winding down and sleep' },
];

// ---------------------------------------------------------------------------
// Episode templates
// ---------------------------------------------------------------------------
// Suggestions, never impositions: the participant confirms, edits, removes or
// writes their own. `applies` narrows the starter set using what they already
// told us, so a participant with no commute is not asked about their commute.

const always = () => true;

export const EPISODE_TEMPLATES = [
  // --- early morning ------------------------------------------------------
  {
    id: 'wake_up',
    band: 'dawn',
    domain: 'morning_routine',
    label: 'Waking up',
    description: 'Getting out of bed and starting the day',
    applies: always,
    weight: 10,
  },
  {
    id: 'bathroom',
    band: 'dawn',
    domain: 'morning_routine',
    label: 'Bathroom and washing up',
    description: 'Getting yourself clean and ready',
    applies: always,
    weight: 9,
  },
  {
    id: 'morning_prayer',
    band: 'dawn',
    domain: 'health',
    label: 'Exercise, walk or prayer',
    description: 'Whatever you do first, if anything',
    applies: always,
    weight: 4,
  },

  // --- morning ------------------------------------------------------------
  {
    id: 'breakfast',
    band: 'morning',
    domain: 'food',
    label: 'Breakfast',
    description: 'Making it, or finding something to eat',
    applies: always,
    weight: 9,
  },
  {
    id: 'get_others_ready',
    band: 'morning',
    domain: 'family_care',
    label: 'Getting someone else ready',
    description: 'Children, or someone you look after',
    applies: (d) => d.has_children === 1 || ['children', 'both', 'elders'].includes(d.caregiving_responsibility),
    weight: 10,
  },
  {
    id: 'morning_commute',
    band: 'morning',
    domain: 'commute',
    label: 'Getting to work or class',
    description: 'The journey out',
    applies: (d) => d.work_arrangement !== 'remote' && d.primary_transport !== 'rarely_travel',
    weight: 9,
  },
  {
    id: 'start_work',
    band: 'morning',
    domain: 'work_study',
    label: 'Starting work or study',
    description: 'Settling in and getting going',
    applies: (d) => d.employment_status !== 'homemaker',
    weight: 8,
  },
  {
    id: 'household_morning',
    band: 'morning',
    domain: 'chores',
    label: 'Morning housework',
    description: 'Whatever had to be done around the house',
    applies: (d) => d.domestic_help === 'none' || d.employment_status === 'homemaker',
    weight: 7,
  },

  // --- midday -------------------------------------------------------------
  {
    id: 'work_block',
    band: 'midday',
    domain: 'work_study',
    label: 'The main stretch of work or study',
    description: 'The part of the day you got things done in',
    applies: (d) => d.employment_status !== 'homemaker',
    weight: 9,
  },
  {
    id: 'lunch',
    band: 'midday',
    domain: 'food',
    label: 'Lunch',
    description: 'Finding, making or fetching it',
    applies: always,
    weight: 8,
  },
  {
    id: 'errand',
    band: 'midday',
    domain: 'money_shopping',
    label: 'An errand or a purchase',
    description: 'Something you had to go out and get, or order',
    applies: always,
    weight: 6,
  },
  {
    id: 'admin_task',
    band: 'midday',
    domain: 'admin',
    label: 'A bill, a form or a payment',
    description: 'Something official that needed dealing with',
    applies: always,
    weight: 5,
  },
  {
    id: 'home_midday',
    band: 'midday',
    domain: 'chores',
    label: 'Running the house',
    description: 'Cooking, cleaning, laundry, the daily round',
    applies: (d) => d.employment_status === 'homemaker' || d.work_arrangement === 'remote',
    weight: 8,
  },

  // --- afternoon ----------------------------------------------------------
  {
    id: 'afternoon_work',
    band: 'afternoon',
    domain: 'work_study',
    label: 'The afternoon',
    description: 'How the second half went',
    applies: (d) => d.employment_status !== 'homemaker',
    weight: 8,
  },
  {
    id: 'device_time',
    band: 'afternoon',
    domain: 'devices',
    label: 'On your phone or computer',
    description: 'Not for work — the scrolling, the messages, the looking things up',
    applies: always,
    weight: 7,
  },
  {
    id: 'evening_commute',
    band: 'afternoon',
    domain: 'commute',
    label: 'The journey home',
    description: 'Getting back',
    applies: (d) => d.work_arrangement !== 'remote' && d.primary_transport !== 'rarely_travel',
    weight: 8,
  },

  // --- evening ------------------------------------------------------------
  {
    id: 'dinner_prep',
    band: 'evening',
    domain: 'food',
    label: 'Dinner',
    description: 'Deciding, cooking, or waiting for it',
    applies: always,
    weight: 9,
  },
  {
    id: 'family_evening',
    band: 'evening',
    domain: 'family_care',
    label: 'Time with family or housemates',
    description: 'Being around the people you live with',
    applies: (d) => d.household_composition && d.household_composition !== 'alone',
    weight: 7,
  },
  {
    id: 'evening_chores',
    band: 'evening',
    domain: 'chores',
    label: 'Clearing up',
    description: 'Dishes, tidying, putting the day away',
    applies: always,
    weight: 7,
  },
  {
    id: 'personal_time',
    band: 'evening',
    domain: 'health',
    label: 'Something for yourself',
    description: 'Rest, a hobby, exercise — or the fact that there was none',
    applies: always,
    weight: 6,
  },

  // --- night --------------------------------------------------------------
  {
    id: 'wind_down',
    band: 'night',
    domain: 'evening_sleep',
    label: 'Winding down',
    description: 'The stretch before you actually slept',
    applies: always,
    weight: 8,
  },
  {
    id: 'sleep',
    band: 'night',
    domain: 'evening_sleep',
    label: 'Going to sleep',
    description: 'Getting to bed, and whether sleep came',
    applies: always,
    weight: 7,
  },
];

/**
 * Picks a starter set for one participant. Aims at 9 to 11 episodes: enough to
 * cover the day, few enough to stay inside the time budget.
 */
export function selectStarterEpisodes(demographics = {}) {
  const d = demographics || {};
  const eligible = EPISODE_TEMPLATES.filter((t) => {
    try {
      return t.applies(d);
    } catch {
      return false;
    }
  });

  const byBand = new Map();
  for (const template of eligible) {
    if (!byBand.has(template.band)) byBand.set(template.band, []);
    byBand.get(template.band).push(template);
  }

  const chosen = [];
  for (const band of TIME_BANDS) {
    const candidates = (byBand.get(band.key) || []).sort((a, b) => b.weight - a.weight);
    // Two per band keeps the strip legible on a phone.
    chosen.push(...candidates.slice(0, 2));
  }

  return chosen.map((template, index) => ({
    ordinal: index,
    templateId: template.id,
    timeBand: template.band,
    domain: template.domain,
    label: template.label,
    description: template.description,
    source: 'template',
  }));
}

// ---------------------------------------------------------------------------
// The Saboteur
// ---------------------------------------------------------------------------
// Reverse-brainstorming. Inventing a harm is a different act from confessing
// one, so it bypasses the "do I have a complaint?" gate entirely — and what
// people reach for first is almost always what already grates on them.

export const SABOTEUR_PROMPTS = [
  {
    key: 'ruin_it',
    template: 'You are back at "{label}". Your job is to ruin it. What would you change to make it as annoying as possible?',
  },
  {
    key: 'make_it_worse',
    template: 'Someone wants to make "{label}" worse without you noticing straight away. What would they do?',
  },
  {
    key: 'twice_as_long',
    template: 'How would you make "{label}" take twice as long?',
  },
  {
    key: 'do_it_again',
    template: 'What would force you to do "{label}" all over again from the start?',
  },
];

/** Deterministic, so a given episode always gets the same prompt. */
export function saboteurPromptFor(episode, index = 0) {
  const prompt = SABOTEUR_PROMPTS[index % SABOTEUR_PROMPTS.length];
  return {
    key: prompt.key,
    text: prompt.template.replace('{label}', episode.label || 'that moment'),
  };
}

export const SABOTEUR_MAX_ROUNDS = 5;
export const SABOTEUR_RESPONSES_PER_ROUND = 3;

// ---------------------------------------------------------------------------
// Forced choice
// ---------------------------------------------------------------------------

export const PAIRWISE_MAX_ROUNDS = 8;

/**
 * Builds pairs from the episodes the participant tagged negatively. Adjacent
 * pairing over a shuffled list gives good coverage in few rounds, which matters
 * when the whole session has to fit in twenty minutes.
 */
export function buildPairs(items, maxRounds = PAIRWISE_MAX_ROUNDS) {
  if (!items || items.length < 2) return [];

  const pool = [...items];
  const pairs = [];

  for (let round = 0; round < 2 && pairs.length < maxRounds; round += 1) {
    // Rotate rather than randomise, so the pairing is reproducible from the
    // stored ordinals when you come to analyse it.
    const rotated = round === 0 ? pool : [...pool.slice(1), pool[0]];
    for (let i = 0; i + 1 < rotated.length && pairs.length < maxRounds; i += 2) {
      pairs.push({ left: rotated[i], right: rotated[i + 1] });
    }
  }

  return pairs;
}
