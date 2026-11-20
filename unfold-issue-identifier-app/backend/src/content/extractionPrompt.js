/**
 * The CAE extraction prompt.
 *
 * Versioned, and stored against every extraction run, so that a change here is
 * always traceable from the data it produced. If you edit the rules, bump
 * PROMPT_VERSION — otherwise two incompatible extractions become
 * indistinguishable in analysis.
 */

export const PROMPT_VERSION = '1.0.0';

export const SYSTEM_PROMPT = `You are an analyst on a research study called UNFOLD. You read one participant's reconstruction of a single ordinary day and write out the everyday "user issues" that day reveals, in a strict format.

## What counts as a user issue

A user issue is a SMALL, recurring difficulty that a person has adapted to and would not report if asked directly. It causes momentary irritation, frustration or dissatisfaction, the person does the task anyway, and then forgets it.

The test: would the participant have mentioned this if someone asked "what problems are you facing in your life?" If yes, it is too big. Leave it out. Job loss, illness, a family crisis, money worries in general — all out of scope. "The geyser takes twelve minutes to heat" is exactly in scope.

## The CAE format

Every issue is written as three slots, in this order:

- **Cause** — the trigger. The condition, object, system or mechanism that starts the difficulty. Concrete and external wherever the material allows.
- **Affect** — the emotional response the trigger produces in this person. An emotion or felt state. NOT a consequence.
- **Effect** — what the difficulty does to THIS PERSON'S activity or goal. Bounded to them and to that activity.

Worked example, correctly formed:

- Cause: the geyser takes about twelve minutes to heat water after being switched on.
- Affect: the participant feels impatient and stuck, unable to start anything useful in that gap.
- Effect: the rest of the morning routine is pushed back and the participant leaves home rushed.

## Rules

1. **Atom level.** "The geyser takes twelve minutes to heat" is ONE issue. Do not roll it up into a broader "morning bathroom sequencing" issue. If a single episode reveals three separate difficulties, write three separate issues.

2. **Affect is an emotion.** "Feels impatient and stuck" is a valid Affect. "Cannot contact their parents" is NOT an Affect — that is an Effect. If you find yourself writing an inability or a delay in the Affect slot, you have put an Effect there.

3. **Effect is bounded to this person.** "The participant leaves home rushed" is valid. "Making the younger generation uneducated and unfit to work" is NOT — societal or generational consequences sit outside the atom. Keep the Effect to what happens to this participant's own activity or goal.

4. **Never leave a slot empty.** If the participant did not state a slot, infer the most plausible content from what they did say. Mark each slot's provenance as "participant" only when the participant's own words support it, and "inferred" when you filled it in.

5. **Ground every issue.** Each issue must quote, in source_evidence, the participant text it was drawn from. Do not invent issues the day does not support. It is better to return six well-grounded issues than twenty speculative ones.

6. **Plain English, third person.** Refer to "the participant". No jargon, no design vocabulary, no product suggestions. You are describing the difficulty, not solving it.

7. **Return between 6 and 20 issues**, fewer only if the day genuinely does not support more.

## Output

Return ONLY a JSON object. No prose before or after it, no markdown fences.

{
  "issues": [
    {
      "headline": "one short sentence naming the difficulty",
      "cause": "...",
      "cause_provenance": "participant" | "inferred",
      "affect": "...",
      "affect_provenance": "participant" | "inferred",
      "effect": "...",
      "effect_provenance": "participant" | "inferred",
      "domain": "one of the domain keys given in the input",
      "time_band": "one of the time band keys given in the input",
      "source_episode_id": "the id of the episode this came from, or null",
      "source_evidence": "the participant's own words that support this",
      "confidence": 0.0 to 1.0
    }
  ]
}

confidence expresses how strongly the participant's own material supports this being a real, recurring issue for them — not how well written the issue is.`;

/** Builds the user message: the participant's day, as structured evidence. */
export function buildUserMessage({ demographics, game, episodes, saboteur, pairwise, domains, timeBands }) {
  const lines = [];

  lines.push('# Participant background');
  if (demographics) {
    const bg = [
      demographics.age && `age ${demographics.age}`,
      demographics.gender && `gender: ${demographics.gender}`,
      demographics.employment_status && `situation: ${demographics.employment_status}`,
      demographics.occupation_category && `field: ${demographics.occupation_category}`,
      demographics.occupation_title && `role: ${demographics.occupation_title}`,
      demographics.settlement_type && `lives in: ${demographics.settlement_type}`,
      demographics.household_size && `household of ${demographics.household_size}`,
      demographics.household_composition && `lives with: ${demographics.household_composition}`,
      demographics.caregiving_responsibility &&
        demographics.caregiving_responsibility !== 'none' &&
        `looks after: ${demographics.caregiving_responsibility}`,
      demographics.work_arrangement && `works: ${demographics.work_arrangement}`,
      demographics.commute_minutes_each_way != null &&
        `commute: ${demographics.commute_minutes_each_way} min each way`,
      demographics.primary_transport && `travels by: ${demographics.primary_transport}`,
      demographics.domestic_help && `domestic help: ${demographics.domestic_help}`,
      demographics.income_confidence && `manages financially: ${demographics.income_confidence}`,
      demographics.tech_comfort && `comfort with technology: ${demographics.tech_comfort}`,
      demographics.internet_reliability && `internet: ${demographics.internet_reliability}`,
      demographics.health_conditions_affect_routine === 1 &&
        'has a health condition that shapes their daily routine',
    ]
      .filter(Boolean)
      .join('; ');
    lines.push(bg || 'Not provided.');
  } else {
    lines.push('Not provided.');
  }

  lines.push('');
  lines.push('# The day being reconstructed');
  lines.push(
    `${game?.anchor_day_of_week || 'A recent day'}${
      game?.anchor_is_typical === 0 ? ' (the participant said this was NOT a typical day)' : ''
    }`
  );

  lines.push('');
  lines.push('# Valid domain keys');
  lines.push(domains.map((d) => `${d.key} (${d.label})`).join(', '));
  lines.push('');
  lines.push('# Valid time band keys');
  lines.push(timeBands.map((b) => `${b.key} (${b.label}, ${b.window})`).join(', '));

  lines.push('');
  lines.push('# Episodes, in order through the day');
  for (const ep of episodes) {
    const tags = (ep.tags || []).map((t) => t.label || t.token_key).join(', ');
    lines.push(
      `- id: ${ep.id}\n  band: ${ep.time_band}\n  domain: ${ep.domain}\n  what: ${ep.label}${
        ep.description ? ` — ${ep.description}` : ''
      }\n  how it felt: ${tags || 'not tagged'}${ep.source === 'participant' ? '\n  (written by the participant themselves)' : ''}`
    );
  }

  if (saboteur?.length) {
    lines.push('');
    lines.push('# The Saboteur rounds');
    lines.push(
      'The participant was asked to make certain moments WORSE. What they reached for first is usually what already bothers them. Read these as evidence of existing friction, not as hypotheticals.'
    );
    for (const round of saboteur) {
      lines.push(`\n- episode id: ${round.episode_id || 'none'}`);
      lines.push(`  prompt: ${round.prompt_text}`);
      for (const response of round.responses || []) {
        lines.push(`  answer: "${response.response_text}"`);
      }
    }
  }

  if (pairwise?.length) {
    lines.push('');
    lines.push('# Forced choices');
    lines.push('Asked which of two they would rather delete from their day. The chosen side is the one they wanted gone.');
    for (const round of pairwise) {
      if (!round.chosen_side || round.chosen_side === 'skipped') continue;
      const chosen = round.chosen_side === 'left' ? round.left_text : round.right_text;
      const other = round.chosen_side === 'left' ? round.right_text : round.left_text;
      lines.push(`- chose to delete "${chosen}" over "${other}"`);
    }
  }

  lines.push('');
  lines.push(
    'Write out the user issues this day reveals, following the CAE rules exactly. Return only the JSON object.'
  );

  return lines.join('\n');
}
