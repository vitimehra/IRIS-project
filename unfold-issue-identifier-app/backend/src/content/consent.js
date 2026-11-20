/**
 * Consent content for UNFOLD.
 *
 * Three audiences, three independently authored documents. The guardian wording
 * is NOT derived from the participant wording by pronoun substitution -- that
 * produces sentences like "a language model can read my answers" on a form a
 * parent signs about their child. Every variant below is written from scratch
 * for the person actually reading it.
 *
 * The exact `text` of every item is copied into `consent_items` at the moment a
 * participant agrees, so a later revision of this file never makes an old
 * consent record uninterpretable.
 */

export const CONSENT_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// THE ONLY PLACE CONTACT DETAILS LIVE.
// Fill these five values before running the study with real participants.
// They appear on the information sheet, the guardian page, the debrief, the
// withdrawal page and the site footer.
// ---------------------------------------------------------------------------
export const STUDY_CONTACTS = {
  studyTitle: "UNFOLD: understanding everyday frictions in an ordinary day",
  researchers: [
    { name: "Viti Mehra", email: "vitimehra@gmail.com" },
    { name: "Sankar Balasubramanian", email: "sankarb.created@gmail.com" },
  ],
  affiliation: "CreatED",
  // An independent contact is required: someone a participant can complain to
  // who is not one of the researchers running the study.
  ethicsContact: {
    label: "Institutional Human Ethics Committee",
    email: "sankarb.created@gmail.com",
  },
  approvalNumber: "IEC/CREATED/2026/001",
};

// ---------------------------------------------------------------------------
// Participant information sheet -- adult (18+)
// ---------------------------------------------------------------------------

export const ADULT_INFO_SHEET = {
  audience: "adult",
  version: CONSENT_VERSION,
  title: "Before you begin",
  sections: [
    {
      heading: "What this study is about",
      body: "We are trying to understand the small difficulties people run into during an ordinary day. Not the big problems in life, but the minor ones that annoy you for a moment and that you then forget about: a queue that moves slowly, an app that makes you repeat yourself, a task you have to redo. These are hard to remember when someone asks you directly, so instead of asking, we will get you to rebuild one real day and notice them as you go.",
    },
    {
      heading: "What you will do",
      body: "You will answer some questions about yourself, then rebuild yesterday as a sequence of moments and mark how each one felt. A few moments will get a short game where we ask you to make that moment worse, which is usually the quickest way to find what already bothers you. At the end you will see a list of everyday issues we think we found in your day, and you will rate how much each one actually matters to you. It takes about 20 minutes.",
    },
    {
      heading: "What we collect",
      body: "Your answers, the choices you make in the game, and how long you spend on each screen. We also record basic background details such as your age, occupation and household, because everyday frictions differ across situations. We do not ask for your full name, phone number, address or any government ID.",
    },
    {
      heading: "How your answers are processed",
      body: "Your written answers are sent to an AI language model (Claude, made by Anthropic) which reads them and writes out the everyday issues it finds. This happens on our server, not in your browser. Anthropic processes the text to produce that output. Everything is stored under a random participant code rather than your name.",
    },
    {
      heading: "Taking part is voluntary",
      body: "You can stop at any point by closing the tab, and you do not have to give a reason. If you want your data deleted afterwards, note down the participant code shown at the end and send it to us. We will delete everything linked to that code.",
    },
    {
      heading: "What happens to the findings",
      body: "This study is part of a larger research project on product design. Anonymised findings may appear in a thesis, in academic papers and in conference presentations. Nothing published will identify you.",
    },
    {
      heading: "Any risks",
      body: "There are no expected risks. Some questions ask about daily routine and household situation, which a few people find personal. You may skip any question you would rather not answer.",
    },
  ],
};

export const ADULT_CONSENT_ITEMS = [
  {
    key: "age_confirm",
    required: true,
    text: "I confirm that I am 18 years of age or older.",
  },
  {
    key: "read_understood",
    required: true,
    text: "I have read and understood the information above, and I have had the chance to ask questions.",
  },
  {
    key: "voluntary",
    required: true,
    text: "I understand that taking part is voluntary, and that I can stop at any time without giving a reason and without any consequence.",
  },
  {
    key: "data_use",
    required: true,
    text: "I agree that my answers and my activity during the game may be stored and analysed for this research.",
  },
  {
    key: "llm_processing",
    required: true,
    text: "I understand that the text I write will be sent to an AI language model (Claude, made by Anthropic) which will identify everyday issues from it.",
  },
  {
    key: "anonymity",
    required: true,
    text: "I understand that my responses are stored under a random participant code, not under my name.",
  },
  {
    key: "withdrawal",
    required: true,
    text: "I understand that I can ask for my data to be deleted afterwards by quoting my participant code.",
  },
  {
    key: "publication",
    required: true,
    text: "I agree that anonymised findings from this study may be published in a thesis, in academic papers and in presentations.",
  },
  {
    key: "recontact",
    required: false,
    text: "Optional: I am willing to be contacted about a short follow-up interview. (You can still take part if you leave this unticked.)",
  },
];

// ---------------------------------------------------------------------------
// Participant information sheet -- 15 to 17, written for the young person
// ---------------------------------------------------------------------------

export const MINOR_INFO_SHEET = {
  audience: "minor",
  version: CONSENT_VERSION,
  title: "Before you start",
  sections: [
    {
      heading: "What this is",
      body: "We are researchers trying to find out what small things annoy people during a normal day. Not big problems. Small ones, like waiting for something to load, or having to do a task twice, or not finding what you need. Most people forget these almost immediately, so asking directly does not work. Instead you will rebuild yesterday, step by step, and we will spot them as you go.",
    },
    {
      heading: "What you will do",
      body: "Answer a few questions about yourself, rebuild yesterday as a set of moments, mark how each one felt, and play a short game where we ask you to make a moment worse. At the end you will see the list of everyday issues we found and you rate how much each one really bothers you. It takes about 20 minutes.",
    },
    {
      heading: "Your parent or guardian has to agree first",
      body: "Because you are under 18, we need a parent or guardian to give permission before you can start. On the next screen you will get a code and a QR code to show them. They read their own version of this page on their own phone and decide there.",
    },
    {
      heading: "You can stop whenever you want",
      body: "Even after your guardian agrees, you do not have to do this. You can close the tab at any point and nothing happens. You can also skip any question you do not want to answer.",
    },
    {
      heading: "What we do with your answers",
      body: "What you write is sent to an AI language model which reads it and writes out the everyday issues it finds. Your answers are saved under a random code, not your name. We never publish anything that identifies you.",
    },
  ],
};

export const MINOR_ASSENT_ITEMS = [
  {
    key: "understood",
    required: true,
    text: "I have read the page above and I understand what this study is asking me to do.",
  },
  {
    key: "questions",
    required: true,
    text: "I know who to contact if I have a question about it.",
  },
  {
    key: "voluntary",
    required: true,
    text: "I understand that I can stop at any time, and that nobody will mind if I do.",
  },
  {
    key: "llm_processing",
    required: true,
    text: "I understand that what I write will be read by an AI language model that picks out everyday issues from it.",
  },
  {
    key: "willing",
    required: true,
    text: "I want to take part.",
  },
];

// ---------------------------------------------------------------------------
// Guardian consent -- written for an adult reading about a young person in
// their care, on their own device.
// ---------------------------------------------------------------------------

export const GUARDIAN_INFO_SHEET = {
  audience: "guardian",
  version: CONSENT_VERSION,
  title: "Permission for your child to take part in a research study",
  sections: [
    {
      heading: "Why you are seeing this",
      body: "A young person in your care has opened a research study on their device and it has asked them to get your permission before continuing. They cannot start until you decide on this page. If you were not expecting this, please check with them before going further.",
    },
    {
      heading: "What the study is about",
      body: "We are studying the small, everyday difficulties people meet during an ordinary day: waiting, repeating a task, hunting for something, dealing with an app that gets in the way. These are hard for anyone to recall on demand, so instead of asking directly we get participants to rebuild one recent day and we notice the friction as they go. The findings feed a larger research project on product design.",
    },
    {
      heading: "What your child will be asked to do",
      body: "They will answer background questions about themselves and their household, rebuild yesterday as a sequence of moments, mark how each moment felt, and play a short game that asks them to imagine making a moment worse. At the end they will see a list of everyday issues drawn from their answers and rate how much each one matters to them. It takes about 20 minutes.",
    },
    {
      heading: "What is collected about your child",
      body: "Their answers, their choices during the game, and how long they spend on each screen, together with background details such as age, education, household composition and daily routine. We do not ask for their full name, phone number, address, school name or any government ID. Responses are stored under a random participant code.",
    },
    {
      heading: "How their answers are processed",
      body: "Text your child writes is sent from our server to an AI language model (Claude, made by Anthropic) which reads it and writes out the everyday issues it finds. Anthropic processes that text in order to produce the output. Nothing identifying your child is included in what is sent.",
    },
    {
      heading: "Taking part is voluntary",
      body: "You may decline, and your child may also decline or stop part-way even after you agree. Neither of you has to give a reason. If you later want their data removed, contact us with the participant code shown at the end of their session and we will delete everything linked to it.",
    },
    {
      heading: "Risks and findings",
      body: "There are no expected risks. A few of the background questions touch on household and financial situation, and your child may skip any question. Anonymised findings may appear in a thesis, in academic papers and in presentations, and will never identify your child.",
    },
  ],
};

export const GUARDIAN_CONSENT_ITEMS = [
  {
    key: "relationship",
    required: true,
    text: "I confirm that I am the parent or legal guardian of the young person who asked me to open this page.",
  },
  {
    key: "read_understood",
    required: true,
    text: "I have read and understood what this study will ask my child to do.",
  },
  {
    key: "voluntary",
    required: true,
    text: "I understand that my child takes part voluntarily, that they may stop at any time, and that neither of us has to give a reason.",
  },
  {
    key: "data_use",
    required: true,
    text: "I agree that my child’s answers and their activity during the game may be stored and analysed for this research.",
  },
  {
    key: "llm_processing",
    required: true,
    text: "I understand that text my child writes will be sent to an AI language model (Claude, made by Anthropic) which will identify everyday issues from it.",
  },
  {
    key: "anonymity",
    required: true,
    text: "I understand that my child’s responses are stored under a random participant code, not under their name.",
  },
  {
    key: "withdrawal",
    required: true,
    text: "I understand that I can ask for my child’s data to be deleted afterwards by quoting their participant code.",
  },
  {
    key: "publication",
    required: true,
    text: "I agree that anonymised findings from this study may be published in a thesis, in academic papers and in presentations.",
  },
  {
    key: "give_permission",
    required: true,
    text: "I give permission for my child to take part in this study.",
  },
];

// ---------------------------------------------------------------------------

export const CONSENT_DOCUMENTS = {
  adult: { infoSheet: ADULT_INFO_SHEET, items: ADULT_CONSENT_ITEMS },
  minor_assent: { infoSheet: MINOR_INFO_SHEET, items: MINOR_ASSENT_ITEMS },
  guardian: { infoSheet: GUARDIAN_INFO_SHEET, items: GUARDIAN_CONSENT_ITEMS },
};

export function getConsentDocument(type) {
  const doc = CONSENT_DOCUMENTS[type];
  if (!doc) return null;
  return {
    consentType: type,
    version: CONSENT_VERSION,
    contacts: STUDY_CONTACTS,
    infoSheet: doc.infoSheet,
    items: doc.items,
  };
}

/** Lookup used when persisting: guarantees stored text matches what was shown. */
export function findConsentItem(type, key) {
  return CONSENT_DOCUMENTS[type]?.items.find((i) => i.key === key) || null;
}

export function requiredItemKeys(type) {
  return (CONSENT_DOCUMENTS[type]?.items || [])
    .filter((i) => i.required)
    .map((i) => i.key);
}
