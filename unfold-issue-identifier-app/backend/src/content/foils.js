/**
 * Foil issues.
 *
 * Plausible-but-fabricated issues seeded among the participant's real ones to
 * measure acquiescence bias. If a participant rates the foils as severely as
 * their genuine issues, their whole rating row is suspect — which is exactly
 * what you want to know before analysing it.
 *
 * Two design constraints:
 *  - They must be plausible enough that agreeing is not obviously wrong.
 *  - They are drawn from domains the participant did NOT report, so a foil is
 *    never accidentally true for them.
 *
 * These are disclosed to the participant at debrief. That disclosure is not
 * optional: it is what makes the deception minimal and defensible.
 */

export const FOIL_VERSION = '1.0.0';

export const FOIL_FAMILIES = [
  {
    key: 'water_pressure',
    domain: 'morning_routine',
    headline: 'The water pressure drops in the evening, so washing up takes longer',
    cause: 'the water pressure in the building drops noticeably during the evening hours',
    affect: 'the participant feels irritated and slowed down',
    effect: 'washing up stretches out and the participant finishes later than intended',
  },
  {
    key: 'lift_alternate',
    domain: 'commute',
    headline: 'The lift is out of service on alternate days',
    cause: 'the lift in the building is switched off on alternate days for maintenance',
    affect: 'the participant feels resigned and mildly annoyed',
    effect: 'the participant has to plan around the stairs and leaves a few minutes earlier',
  },
  {
    key: 'grocery_layout',
    domain: 'money_shopping',
    headline: 'The shop rearranges its shelves every few weeks',
    cause: 'the shop the participant uses rearranges its shelf layout every few weeks',
    affect: 'the participant feels disoriented and faintly frustrated',
    effect: 'a routine shop takes longer than it should and items get missed',
  },
  {
    key: 'printer_queue',
    domain: 'work_study',
    headline: 'The shared printer holds jobs until someone clears the queue',
    cause: 'the shared printer silently holds jobs until somebody clears the queue',
    affect: 'the participant feels puzzled and then exasperated',
    effect: 'the participant walks to the printer twice for one document',
  },
  {
    key: 'fridge_shelf',
    domain: 'food',
    headline: 'The top fridge shelf freezes whatever is left on it overnight',
    cause: 'the top shelf of the fridge runs cold enough to freeze items left on it overnight',
    affect: 'the participant feels annoyed at the waste',
    effect: 'the participant has to remember to rearrange the fridge before bed',
  },
  {
    key: 'app_logout',
    domain: 'devices',
    headline: 'One app signs the participant out every few days',
    cause: 'one of the apps the participant uses signs them out every few days',
    affect: 'the participant feels irritated at having to prove themselves again',
    effect: 'the participant loses a minute retrieving the password when they were mid-task',
  },
  {
    key: 'bill_reminder',
    domain: 'admin',
    headline: 'A bill reminder arrives after the due date',
    cause: 'one recurring bill sends its reminder after the payment is already due',
    affect: 'the participant feels caught out and slightly anxious',
    effect: 'the participant has to check the account manually to avoid a late charge',
  },
  {
    key: 'laundry_dry',
    domain: 'chores',
    headline: 'Clothes take an extra day to dry on the shaded side',
    cause: 'the drying space gets no direct sun, so clothes need an extra day',
    affect: 'the participant feels mildly frustrated at the delay',
    effect: 'the participant has to plan laundry further ahead than they would like',
  },
  {
    key: 'sleep_streetlight',
    domain: 'evening_sleep',
    headline: 'A streetlight outside makes the room too bright to sleep',
    cause: 'a streetlight outside the window keeps the room lit at night',
    affect: 'the participant feels restless and unable to settle',
    effect: 'the participant takes longer to fall asleep than they would otherwise',
  },
  {
    key: 'clinic_callback',
    domain: 'health',
    headline: 'The clinic only returns calls during working hours',
    cause: 'the clinic returns calls only in a narrow window during working hours',
    affect: 'the participant feels frustrated at being unreachable',
    effect: 'the participant misses the callback and has to start the request again',
  },
];

/**
 * Picks foils from domains the participant's own day did not touch, so a foil
 * is never accidentally a real issue for them.
 */
export function selectFoils(usedDomains = [], count = 3) {
  const used = new Set(usedDomains.filter(Boolean));
  const unused = FOIL_FAMILIES.filter((f) => !used.has(f.domain));

  // If their day covered nearly everything, fall back to the full set rather
  // than shipping fewer foils than the design calls for.
  const pool = unused.length >= count ? unused : FOIL_FAMILIES;

  const picked = [];
  const seen = new Set();
  for (const foil of pool) {
    if (picked.length >= count) break;
    if (seen.has(foil.domain)) continue; // spread them across domains
    seen.add(foil.domain);
    picked.push(foil);
  }

  // Top up if the domain-spreading rule left us short.
  for (const foil of pool) {
    if (picked.length >= count) break;
    if (!picked.includes(foil)) picked.push(foil);
  }

  return picked.slice(0, count);
}
