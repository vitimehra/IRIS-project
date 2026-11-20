"""
Every prompt VITIS sends to Claude.

Versioned as a whole. Bump PROMPT_VERSION when any of them changes; it is
stamped into every ai_calls row, so output from two prompt versions is never
mixed in analysis.

The frameworks are the project's own notation, taken verbatim from the
"Illusion of Novelty" document:
  user issue      CAE   cause, affect, effect
  problem         AOPC  action, object, party, context
  idea            PP    principle, phenomenon     (what should happen)
  concept         OC    object, characteristics   (how it should happen)
"""

PROMPT_VERSION = "1.1.0"

FRAMEWORK = """
## The notation

**User issue = CAE.** A small, recurring difficulty a person has adapted to.
- Cause: the trigger - the condition, object or mechanism that starts it. Concrete.
- Affect: the emotional response in the person. An emotion, never a consequence.
- Effect: what it does to THIS person's activity or goal. Bounded to them; societal consequences are out of scope.
Atom level: "the geyser takes twelve minutes to heat" is one issue. Never merge several difficulties into one.

**Problem = AOPC.** A problem statement extracted from an issue, phrased so a designer could act on it.
- Action: the verb - what happens or must happen (draining, notify, disengage).
- Object: the thing the action is performed on or by (battery, notification, phone).
- Party: who is affected or involved (the user, the parent, the commuter).
- Context: the circumstance that makes it a problem (capacity, dormant apps, preemptive, conservation).

**Idea = PP.** *What should happen.* An abstract mechanism, not a product.
- Principle: the scientific or behavioural principle exploited.
- Phenomenon: the observable phenomenon that principle triggers, and how it addresses the problem.
Example: "Sudden change in light triggers immediate visual attention" - principle: contrast detection in peripheral vision; phenomenon: a colour shift the eye cannot ignore.

**Concept = OC.** *How it should happen.* A physical embodiment of one idea.
- Object: the thing, with a clear shape, size and form.
- Characteristics: its features - materials, colour, dimensions, interface, where it lives, how it behaves.
Example: a colour-changing bracelet, thermochromic silicone, 15 mm band, shifts from grey to amber when the paired phone drops below 15%.
""".strip()

SYSTEM = f"""You are the analysis engine inside VITIS, a research tool that turns a person's everyday difficulties into structured design ideas. You follow the project's notation exactly and return only JSON.

{FRAMEWORK}

Rules that apply to every task:
- Plain English. Third person for the participant ("the participant").
- Return ONLY a JSON object. No prose before or after. No markdown fences.
- Ground everything in what the participant actually said; quote their words in `evidence` fields where asked.
- Never invent details about the participant's life.
"""

# --- stage prompts -------------------------------------------------------------

CAE_EXTRACT = """The participant described what bothers them in their own words. Extract every distinct user issue it contains, as CAE triples. Split merged complaints into atoms. Between 1 and 6 issues.

Participant's words:
\"\"\"
{issue_text}
\"\"\"

Return:
{{"issues": [{{"headline": "one short sentence", "cause": "...", "affect": "...", "effect": "...", "evidence": "the participant's own words this came from"}}]}}"""

PROBLEMS_IDENTIFY = """From these confirmed user issues, identify the design problems they imply. A problem is something a designer could act on. Several issues may point at one problem, and one issue may contain two. Between 2 and 6 problems, most prominent first.

Issues:
{issues_json}

Return:
{{"problems": [{{"statement": "one sentence, plain English", "rationale": "why this is the problem behind the issue(s)", "source_issue_ordinals": [1, 2]}}]}}"""

AOPC_STRUCTURE = """Structure this problem in the AOPC notation. Each slot is a short phrase, not a sentence.

Problem: {statement}
Rationale: {rationale}
Underlying issues:
{issues_json}

Return:
{{"action": "...", "object": "...", "party": "...", "context": "...", "restated": "the problem restated in one sentence using all four slots"}}"""

TRADITIONAL_STRUCTURE = """The participant wrote these ideas themselves, in free text, for the problem below. Restructure each into the PP notation WITHOUT adding anything the participant did not express. If an idea lacks a principle or phenomenon, infer the most faithful reading and mark it inferred. Keep the participant's wording where possible.

Problem (AOPC): action={action}; object={object}; party={party}; context={context}

Participant's ideas:
{ideas_json}

Return:
{{"ideas": [{{"ordinal": 1, "title": "3-6 words", "principle": "...", "principle_inferred": false, "phenomenon": "...", "phenomenon_inferred": false}}]}}"""

IDEAS_MODERN = """Generate {n} ideas for this problem, in PP notation. Each idea must exploit a DIFFERENT principle. Ideas describe what should happen, not a product - no objects, no materials, no brand names.

Problem (AOPC): action={action}; object={object}; party={party}; context={context}
Restated: {restated}

Return:
{{"ideas": [{{"ordinal": 1, "title": "3-6 words", "principle": "...", "phenomenon": "..."}}]}}"""

KEYWORDS_PROPOSE = """Propose {n} English VERBS that name the kinds of action a solution to this problem might perform or exploit. These are search keys into a knowledge graph of verbs, so each must be a single base-form verb (rise, notify, absorb), not a phrase. Range widely: include at least two that are not obvious from the wording of the problem.

Problem (AOPC): action={action}; object={object}; party={party}; context={context}
Restated: {restated}

Return:
{{"keywords": [{{"verb": "notify", "rationale": "one line: why this action could lead to a design direction"}}]}}"""

PHENOMENA_SEARCH = """Find {n} real-world phenomena - in nature, physics, biology, engineering, everyday life or culture - whose action is described by the verb "{verb}" ({gloss}). Use web search to find genuine, specific, citable phenomena, not generic descriptions. Plan your searches: you have very few, so make each one broad (for example the verb plus "phenomenon nature science", then the verb plus "engineering everyday example") and draw several phenomena from each results page. Prefer phenomena from domains unrelated to the design problem below, because those are the ones that inspire.

The phenomena will be used as inspiration for this problem, but must NOT be solutions to it:
Problem: {restated}

Already known for this verb (do not repeat these):
{existing_json}

Output discipline: write nothing before or after the JSON - no commentary between searches, no summary. Do not put citation markup or tags inside the JSON; the page URL in source_url is the citation. Keep each description to 2-3 plain sentences.

Return:
{{"phenomena": [{{"title": "3-8 words", "description": "2-3 sentences: what happens and the mechanism behind it", "domain": "nature | physics | chemistry | biology | engineering | everyday | culture", "source_url": "the page that describes it", "source_title": "..."}}]}}"""

PHENOMENA_GENERATE = """Propose {n} real-world phenomena - in nature, physics, biology, engineering, everyday life or culture - whose action is described by the verb "{verb}" ({gloss}). You cannot search the web this time: use well-known, specific phenomena from science and everyday life, not generic descriptions. Prefer phenomena from domains unrelated to the design problem below, because those are the ones that inspire.

The phenomena will be used as inspiration for this problem, but must NOT be solutions to it:
Problem: {restated}

Already known for this verb (do not repeat these):
{existing_json}

Return:
{{"phenomena": [{{"title": "3-8 words", "description": "2-3 sentences: what happens and the mechanism behind it", "domain": "nature | physics | chemistry | biology | engineering | everyday | culture", "source_url": "", "source_title": "well-known phenomenon"}}]}}"""

IDEAS_INSPIDER = """Generate exactly {n} ideas for this problem, in PP notation, each INSPIRED BY the phenomena of one verb from the Inspider web below. Transfer the mechanism of the phenomenon to the problem: the principle comes from the phenomenon, the application is to the problem. Ideas describe what should happen, not a product.

One idea per verb: idea k draws only on the phenomena listed under the verb whose idea_ordinal is k. {n_verbs} verbs are listed; if that is fewer than {n}, the remaining ideas may draw on any verb but must borrow a different mechanism from every earlier idea. Each idea cites the phenomena it used by id and names its verb.

Problem (AOPC): action={action}; object={object}; party={party}; context={context}
Restated: {restated}

Verbs and their phenomena:
{verbs_json}

Return:
{{"ideas": [{{"ordinal": 1, "verb": "the verb", "title": "3-6 words", "principle": "...", "phenomenon": "...", "inspired_by": [12, 15], "transfer": "one line: what was borrowed from the phenomenon"}}]}}"""

CONCEPT_FROM_IDEA = """Turn this idea into ONE concept in OC notation: a concrete physical embodiment with a clear shape, size and form. Be specific enough that a product designer could sketch it.

Problem (AOPC): action={action}; object={object}; party={party}; context={context}
Idea: {title}
  Principle: {principle}
  Phenomenon: {phenomenon}

Return:
{{"title": "3-6 words, the product name", "object": "one sentence: what the thing is", "characteristics": ["shape and size", "materials and colour", "interface / how the person interacts with it", "where it lives in daily life", "what it does when triggered", "one more distinguishing feature"], "how_it_works": "2-3 sentences tying the object back to the principle"}}"""

RENDER_PROMPTS = """Write two image-generation prompts for this product concept. Photorealistic, no text or labels in the image, no people's faces in close-up.

Concept: {title}
Object: {object}
Characteristics: {characteristics}

- product: a studio product photograph of the object alone on a neutral background, three-quarter view, soft lighting, showing shape, material and colour exactly as described.
- in_use: the object in realistic everyday use by {party} in the situation "{context}", candid documentary style, natural light, the object clearly visible and in action.

Each prompt under 120 words. Return exactly ONE JSON object containing BOTH keys, nothing else:
{{"product": "...", "in_use": "..."}}"""
