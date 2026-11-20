/**
 * Demographic instrument definition.
 *
 * Single source of truth: the backend validates and column-maps against this,
 * and serves it to the frontend which renders the form from it. Adding a field
 * here makes it appear in the UI and land in `raw_payload` immediately; give it
 * a matching column in schema.sql if you also want it as an analysis column.
 *
 * Every field is skippable. This is a research instrument, and a participant who
 * abandons at a mandatory income question yields nothing at all.
 */

export const DEMOGRAPHICS_VERSION = '1.0.0';

const PREFER_NOT = { value: 'prefer_not_to_say', label: 'Prefer not to say' };

export const DEMOGRAPHIC_STEPS = [
  {
    key: 'about_you',
    title: 'About you',
    blurb: 'Nothing here identifies you. First name only, and even that is optional.',
    fields: [
      {
        key: 'first_name',
        label: 'First name',
        type: 'text',
        optional: true,
        maxLength: 60,
        help: 'Only used to greet you during the game. Leave it blank if you prefer.',
      },
      {
        key: 'age',
        label: 'Age',
        type: 'number',
        min: 15,
        max: 50,
        required: true,
      },
      {
        key: 'gender',
        label: 'Gender',
        type: 'select',
        options: [
          { value: 'woman', label: 'Woman' },
          { value: 'man', label: 'Man' },
          { value: 'non_binary', label: 'Non-binary' },
          { value: 'self_describe', label: 'Prefer to self-describe' },
          PREFER_NOT,
        ],
      },
      {
        key: 'gender_self_described',
        label: 'Self-described gender',
        type: 'text',
        optional: true,
        maxLength: 80,
        showIf: { field: 'gender', equals: 'self_describe' },
      },
      {
        key: 'primary_language',
        label: 'Language you are most comfortable in',
        type: 'text',
        maxLength: 60,
        help: 'The study runs in English, but knowing this helps us interpret your answers.',
      },
      {
        key: 'languages_spoken',
        label: 'Other languages you use day to day',
        type: 'text',
        optional: true,
        maxLength: 200,
        help: 'Separate with commas.',
      },
    ],
  },

  {
    key: 'living',
    title: 'Where and how you live',
    blurb: 'Daily frictions differ a lot by household. This is the part that makes the findings useful.',
    fields: [
      {
        key: 'country',
        label: 'Country',
        type: 'text',
        maxLength: 80,
        default: 'India',
      },
      { key: 'state_region', label: 'State or region', type: 'text', maxLength: 80, optional: true },
      { key: 'city', label: 'City, town or village', type: 'text', maxLength: 80, optional: true },
      {
        key: 'settlement_type',
        label: 'Which best describes where you live?',
        type: 'select',
        options: [
          { value: 'metro', label: 'Large metro city' },
          { value: 'tier2_city', label: 'Smaller city' },
          { value: 'town', label: 'Town' },
          { value: 'rural', label: 'Village or rural area' },
          PREFER_NOT,
        ],
      },
      {
        key: 'housing_type',
        label: 'Type of home',
        type: 'select',
        options: [
          { value: 'owned_house', label: 'Owned house' },
          { value: 'owned_flat', label: 'Owned flat or apartment' },
          { value: 'rented_house', label: 'Rented house' },
          { value: 'rented_flat', label: 'Rented flat or apartment' },
          { value: 'shared_pg_hostel', label: 'Shared accommodation, PG or hostel' },
          { value: 'family_home', label: 'Family home, not mine or rented' },
          { value: 'other', label: 'Other' },
          PREFER_NOT,
        ],
      },
      {
        key: 'household_size',
        label: 'How many people live in your home, including you?',
        type: 'number',
        min: 1,
        max: 30,
      },
      {
        key: 'household_composition',
        label: 'Who do you live with?',
        type: 'multiselect',
        options: [
          { value: 'alone', label: 'I live alone' },
          { value: 'partner', label: 'Partner or spouse' },
          { value: 'children', label: 'My children' },
          { value: 'parents', label: 'Parents' },
          { value: 'grandparents', label: 'Grandparents' },
          { value: 'siblings', label: 'Siblings' },
          { value: 'extended_family', label: 'Other relatives' },
          { value: 'flatmates', label: 'Flatmates or roommates' },
        ],
      },
      {
        key: 'marital_status',
        label: 'Marital status',
        type: 'select',
        options: [
          { value: 'single', label: 'Single' },
          { value: 'in_relationship', label: 'In a relationship, not married' },
          { value: 'married', label: 'Married' },
          { value: 'separated_divorced', label: 'Separated or divorced' },
          { value: 'widowed', label: 'Widowed' },
          PREFER_NOT,
        ],
      },
      {
        key: 'has_children',
        label: 'Do you have children?',
        type: 'boolean',
      },
      {
        key: 'children_count',
        label: 'How many?',
        type: 'number',
        min: 1,
        max: 15,
        showIf: { field: 'has_children', equals: true },
      },
      {
        key: 'caregiving_responsibility',
        label: 'Do you regularly look after someone?',
        type: 'select',
        options: [
          { value: 'none', label: 'No' },
          { value: 'children', label: 'Children' },
          { value: 'elders', label: 'Elderly family members' },
          { value: 'both', label: 'Both children and elders' },
          { value: 'other', label: 'Someone else' },
          PREFER_NOT,
        ],
      },
      {
        key: 'domestic_help',
        label: 'Do you have help with housework?',
        type: 'select',
        options: [
          { value: 'none', label: 'No, I do it all myself' },
          { value: 'shared_household', label: 'Shared with others in the household' },
          { value: 'part_time_help', label: 'Part-time domestic help' },
          { value: 'full_time_help', label: 'Full-time domestic help' },
          PREFER_NOT,
        ],
      },
    ],
  },

  {
    key: 'work_study',
    title: 'Work and study',
    blurb: 'How your day is structured shapes where the friction sits.',
    fields: [
      {
        key: 'education_level',
        label: 'Highest level of education completed',
        type: 'select',
        options: [
          { value: 'school_incomplete', label: 'Still at school' },
          { value: 'school', label: 'School' },
          { value: 'diploma', label: 'Diploma or certificate' },
          { value: 'bachelors', label: "Bachelor's degree" },
          { value: 'masters', label: "Master's degree" },
          { value: 'doctorate', label: 'Doctorate' },
          { value: 'other', label: 'Other' },
          PREFER_NOT,
        ],
      },
      {
        key: 'employment_status',
        label: 'Current situation',
        type: 'select',
        options: [
          { value: 'student', label: 'Student' },
          { value: 'employed_full', label: 'Employed full-time' },
          { value: 'employed_part', label: 'Employed part-time' },
          { value: 'self_employed', label: 'Self-employed or freelance' },
          { value: 'business_owner', label: 'Business owner' },
          { value: 'homemaker', label: 'Homemaker' },
          { value: 'seeking_work', label: 'Looking for work' },
          { value: 'retired', label: 'Retired' },
          { value: 'other', label: 'Other' },
          PREFER_NOT,
        ],
      },
      {
        key: 'occupation_category',
        label: 'Field of work or study',
        type: 'select',
        options: [
          { value: 'it_software', label: 'IT and software' },
          { value: 'engineering', label: 'Engineering and manufacturing' },
          { value: 'healthcare', label: 'Healthcare' },
          { value: 'education', label: 'Education and research' },
          { value: 'business_finance', label: 'Business, finance and administration' },
          { value: 'sales_retail', label: 'Sales and retail' },
          { value: 'creative_media', label: 'Creative and media' },
          { value: 'government_public', label: 'Government and public service' },
          { value: 'skilled_trade', label: 'Skilled trade or services' },
          { value: 'agriculture', label: 'Agriculture' },
          { value: 'homemaking', label: 'Running a household' },
          { value: 'student', label: 'Studying' },
          { value: 'other', label: 'Other' },
          PREFER_NOT,
        ],
      },
      {
        key: 'occupation_title',
        label: 'What do you actually do? A few words is fine.',
        type: 'text',
        optional: true,
        maxLength: 120,
      },
      {
        key: 'student_status',
        label: 'What are you studying?',
        type: 'text',
        optional: true,
        maxLength: 120,
        showIf: { field: 'employment_status', equals: 'student' },
      },
      {
        key: 'work_arrangement',
        label: 'Where do you work or study from?',
        type: 'select',
        options: [
          { value: 'onsite', label: 'Mostly at a workplace or campus' },
          { value: 'hybrid', label: 'A mix of home and workplace' },
          { value: 'remote', label: 'Mostly from home' },
          { value: 'field', label: 'On the move or in the field' },
          { value: 'na', label: 'Not applicable' },
        ],
      },
      {
        key: 'work_hours_per_week',
        label: 'Roughly how many hours a week?',
        type: 'number',
        min: 0,
        max: 120,
        optional: true,
      },
      {
        key: 'primary_transport',
        label: 'How do you usually get around?',
        type: 'select',
        options: [
          { value: 'walk', label: 'Walk' },
          { value: 'cycle', label: 'Cycle' },
          { value: 'two_wheeler', label: 'Two-wheeler' },
          { value: 'car', label: 'Car' },
          { value: 'bus', label: 'Bus' },
          { value: 'train_metro', label: 'Train or metro' },
          { value: 'auto_taxi', label: 'Auto or taxi' },
          { value: 'mixed', label: 'A mix' },
          { value: 'rarely_travel', label: 'I rarely travel' },
        ],
      },
      {
        key: 'commute_minutes_each_way',
        label: 'Typical one-way travel time, in minutes',
        type: 'number',
        min: 0,
        max: 300,
        optional: true,
      },
    ],
  },

  {
    key: 'money_tech_health',
    title: 'Money, technology and health',
    blurb: 'The last few. Skip anything you would rather not answer.',
    fields: [
      {
        key: 'income_band',
        label: 'Approximate monthly household income',
        type: 'select',
        optional: true,
        options: [
          { value: 'under_20k', label: 'Under 20,000' },
          { value: '20k_50k', label: '20,000 to 50,000' },
          { value: '50k_100k', label: '50,000 to 1,00,000' },
          { value: '100k_200k', label: '1,00,000 to 2,00,000' },
          { value: 'above_200k', label: 'Above 2,00,000' },
          { value: 'no_income', label: 'No income of my own' },
          PREFER_NOT,
        ],
        help: 'In your local currency. This is optional.',
      },
      {
        key: 'income_confidence',
        label: 'How comfortably does your household manage financially?',
        type: 'select',
        options: [
          { value: 'very_comfortable', label: 'Very comfortably' },
          { value: 'comfortable', label: 'Comfortably' },
          { value: 'just_managing', label: 'Just managing' },
          { value: 'difficult', label: 'With difficulty' },
          { value: 'very_difficult', label: 'With a lot of difficulty' },
          PREFER_NOT,
        ],
        help: 'Often more informative than the number above.',
      },
      {
        key: 'smartphone_os',
        label: 'Phone you use',
        type: 'select',
        options: [
          { value: 'android', label: 'Android' },
          { value: 'ios', label: 'iPhone' },
          { value: 'other', label: 'Something else' },
          { value: 'none', label: 'I do not use a smartphone' },
        ],
      },
      {
        key: 'daily_screen_hours',
        label: 'Roughly how many hours a day on a phone or computer, outside work?',
        type: 'number',
        min: 0,
        max: 24,
        step: 0.5,
        optional: true,
      },
      {
        key: 'internet_reliability',
        label: 'How reliable is your internet?',
        type: 'select',
        options: [
          { value: 'very_reliable', label: 'Very reliable' },
          { value: 'mostly_reliable', label: 'Mostly reliable' },
          { value: 'patchy', label: 'Patchy' },
          { value: 'often_unavailable', label: 'Often unavailable' },
        ],
      },
      {
        key: 'tech_comfort',
        label: 'How comfortable are you with new apps and devices?',
        type: 'select',
        options: [
          { value: 'very_comfortable', label: 'Very comfortable, I figure things out quickly' },
          { value: 'comfortable', label: 'Comfortable enough' },
          { value: 'neutral', label: 'It depends' },
          { value: 'uncomfortable', label: 'I find it difficult' },
          { value: 'avoid', label: 'I avoid it where I can' },
        ],
      },
      {
        key: 'health_conditions_affect_routine',
        label: 'Is there a health condition that shapes your daily routine?',
        type: 'boolean',
        optional: true,
        help: 'We do not ask what it is. Only whether your day is built around one.',
      },
      {
        key: 'accessibility_needs',
        label: 'Anything we should know that affects how you use a phone or computer?',
        type: 'textarea',
        optional: true,
        maxLength: 500,
      },
    ],
  },
];

/** Flat list, in order. */
export const DEMOGRAPHIC_FIELDS = DEMOGRAPHIC_STEPS.flatMap((s) => s.fields);

/** Fields with a matching column in the demographics table. */
export const MAPPED_COLUMNS = [
  'first_name',
  'age',
  'age_band',
  'gender',
  'gender_self_described',
  'country',
  'state_region',
  'city',
  'settlement_type',
  'education_level',
  'occupation_category',
  'occupation_title',
  'employment_status',
  'work_arrangement',
  'work_hours_per_week',
  'student_status',
  'household_size',
  'household_composition',
  'marital_status',
  'has_children',
  'children_count',
  'caregiving_responsibility',
  'income_band',
  'income_confidence',
  'housing_type',
  'domestic_help',
  'primary_transport',
  'commute_minutes_each_way',
  'smartphone_os',
  'daily_screen_hours',
  'internet_reliability',
  'tech_comfort',
  'health_conditions_affect_routine',
  'accessibility_needs',
  'primary_language',
  'languages_spoken',
];

export function ageBand(age) {
  const n = Number(age);
  if (!Number.isFinite(n)) return null;
  if (n < 18) return '15_17';
  if (n < 25) return '18_24';
  if (n < 35) return '25_34';
  if (n < 45) return '35_44';
  return '45_50';
}
