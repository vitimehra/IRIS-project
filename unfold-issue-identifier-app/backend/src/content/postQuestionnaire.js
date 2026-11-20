/**
 * The post-questionnaire.
 *
 * Deliberately short, and deliberately separate from the rating screen. The
 * ratings are instrument data about the participant's life; these questions are
 * feedback about the instrument itself. Mixing them would make both harder to
 * interpret.
 *
 * The recall-order questions matter most: they are the closest thing the study
 * has to a check on whether the game actually beat recall bias, which is its
 * entire premise.
 */

export const POST_QUESTIONNAIRE_VERSION = '1.0.0';

const AGREEMENT = [
  { value: '1', label: 'Strongly disagree' },
  { value: '2', label: 'Disagree' },
  { value: '3', label: 'Neither' },
  { value: '4', label: 'Agree' },
  { value: '5', label: 'Strongly agree' },
];

export const POST_QUESTIONNAIRE = [
  {
    key: 'recognised_own_day',
    type: 'scale',
    text: 'The day I rebuilt felt like an accurate picture of yesterday.',
    options: AGREEMENT,
    required: true,
  },
  {
    key: 'issues_felt_mine',
    type: 'scale',
    text: 'The issues I was shown felt like things I actually run into.',
    options: AGREEMENT,
    required: true,
  },
  {
    key: 'would_not_have_recalled',
    type: 'scale',
    text: 'Some of those issues are things I would not have thought of if you had simply asked me to list my problems.',
    options: AGREEMENT,
    required: true,
    help: 'This is the question the whole study rests on, so please answer it honestly rather than kindly.',
  },
  {
    key: 'saboteur_easy',
    type: 'scale',
    text: 'Being asked to make a moment worse was easier than being asked what annoys me.',
    options: AGREEMENT,
    required: false,
  },
  {
    key: 'missed_something',
    type: 'text',
    text: 'Is there anything that bothered you yesterday that we did not pick up?',
    placeholder: 'Anything at all, however small.',
    required: false,
    maxLength: 1000,
  },
  {
    key: 'hardest_part',
    type: 'choice',
    text: 'Which part was hardest?',
    options: [
      { value: 'rebuilding_day', label: 'Rebuilding the day' },
      { value: 'tagging', label: 'Choosing how each moment felt' },
      { value: 'saboteur', label: 'Making moments worse' },
      { value: 'choosing_pairs', label: 'Choosing between two' },
      { value: 'rating', label: 'Rating the issues' },
      { value: 'none', label: 'None of it was hard' },
    ],
    required: false,
  },
  {
    key: 'felt_too_long',
    type: 'scale',
    text: 'The study took longer than I expected.',
    options: AGREEMENT,
    required: false,
  },
  {
    key: 'anything_else',
    type: 'text',
    text: 'Anything else you would like to tell us?',
    placeholder: 'About the study, the questions, or how it felt to do.',
    required: false,
    maxLength: 1000,
  },
];

export const QUESTION_BY_KEY = new Map(POST_QUESTIONNAIRE.map((q) => [q.key, q]));
