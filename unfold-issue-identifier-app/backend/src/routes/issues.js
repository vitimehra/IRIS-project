import { Router } from 'express';
import { getDb, transact } from '../db/index.js';
import { newId } from '../services/ids.js';
import { publicSession, updateSession } from '../services/sessions.js';
import { requireSession } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden } from '../middleware/errors.js';
import { runExtraction } from '../services/extraction.js';
import { persistIssues, ratingDeck, saveRating, debriefPayload } from '../services/issues.js';
import {
  POST_QUESTIONNAIRE,
  POST_QUESTIONNAIRE_VERSION,
  QUESTION_BY_KEY,
} from '../content/postQuestionnaire.js';

export const issuesRouter = Router();

/**
 * POST /api/issues/extract
 * Runs the model over the participant's day and builds the rating deck.
 * Idempotent: calling it again while a deck already exists returns that deck
 * rather than spending another API call on a page refresh.
 */
issuesRouter.post(
  '/extract',
  requireSession,
  asyncHandler(async (req, res) => {
    if (!['game_done', 'rated', 'completed'].includes(req.session.status)) {
      throw forbidden('Finish the day reconstruction first.');
    }

    const existing = getDb()
      .prepare(
        `SELECT COUNT(*) n FROM issues WHERE session_id = ? AND shown_to_participant = 1`
      )
      .get(req.session.id).n;

    if (existing > 0 && !req.body?.force) {
      return res.json({ issues: ratingDeck(req.session.id), reused: true });
    }

    const { runId, issues, status } = await runExtraction(req.session.id);
    const counts = persistIssues({
      sessionId: req.session.id,
      extractionRunId: runId,
      issues,
    });

    res.status(201).json({
      issues: ratingDeck(req.session.id),
      // The participant is never told which cards are foils, but the researcher
      // needs the counts, so they go in the extraction_runs row rather than here.
      extraction: { status, shown: counts.shown, hidden: counts.hidden },
      reused: false,
    });
  })
);

/** GET /api/issues/mine — the rating deck, with foil flags stripped. */
issuesRouter.get(
  '/mine',
  requireSession,
  asyncHandler(async (req, res) => {
    const db = getDb();
    const ratings = db
      .prepare(`SELECT issue_id, severity, rejected FROM issue_ratings WHERE session_id = ?`)
      .all(req.session.id);
    const byIssue = new Map(ratings.map((r) => [r.issue_id, r]));

    const issues = ratingDeck(req.session.id).map((issue) => ({
      ...issue,
      rating: byIssue.get(issue.id)
        ? {
            severity: byIssue.get(issue.id).severity,
            rejected: Boolean(byIssue.get(issue.id).rejected),
          }
        : null,
    }));

    res.json({ issues });
  })
);

/** POST /api/issues/:id/rating */
issuesRouter.post(
  '/:id/rating',
  requireSession,
  asyncHandler(async (req, res) => {
    const result = saveRating({
      sessionId: req.session.id,
      issueId: req.params.id,
      rating: req.body || {},
    });

    if (!result) throw badRequest('That issue does not belong to this session.');
    if (result.error) throw badRequest(result.error);

    res.json({ saved: true });
  })
);

/** POST /api/issues/ratings — batch, so a flaky connection cannot lose a screenful. */
issuesRouter.post(
  '/ratings',
  requireSession,
  asyncHandler(async (req, res) => {
    const ratings = Array.isArray(req.body?.ratings) ? req.body.ratings : null;
    if (!ratings) throw badRequest('ratings must be an array.');

    let saved = 0;
    const errors = [];
    for (const rating of ratings) {
      const result = saveRating({
        sessionId: req.session.id,
        issueId: rating.issueId,
        rating,
      });
      if (result?.saved) saved += 1;
      else errors.push({ issueId: rating.issueId, error: result?.error || 'not found' });
    }

    res.json({ saved, errors });
  })
);

/** POST /api/issues/ratings/complete */
issuesRouter.post(
  '/ratings/complete',
  requireSession,
  asyncHandler(async (req, res) => {
    const updated = updateSession(req.session.id, {
      status: 'rated',
      stage: 'post_questionnaire',
    });
    res.json({ session: publicSession(updated) });
  })
);

// ---------------------------------------------------------------------------
// Post-questionnaire
// ---------------------------------------------------------------------------

issuesRouter.get(
  '/questionnaire/schema',
  asyncHandler(async (_req, res) => {
    res.json({ version: POST_QUESTIONNAIRE_VERSION, questions: POST_QUESTIONNAIRE });
  })
);

issuesRouter.post(
  '/questionnaire',
  requireSession,
  asyncHandler(async (req, res) => {
    const answers = req.body?.answers;
    if (!answers || typeof answers !== 'object') throw badRequest('answers is required.');

    const missing = POST_QUESTIONNAIRE.filter(
      (q) => q.required && (answers[q.key] === undefined || answers[q.key] === '')
    ).map((q) => q.key);
    if (missing.length > 0) {
      throw badRequest('Some required questions have not been answered.', { missing });
    }

    transact(() => {
      const db = getDb();
      db.prepare(`DELETE FROM post_questionnaire_responses WHERE session_id = ?`).run(req.session.id);

      const insert = db.prepare(
        `INSERT INTO post_questionnaire_responses (
           id, session_id, question_key, question_text, response_value, response_text, response_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      for (const [key, value] of Object.entries(answers)) {
        const question = QUESTION_BY_KEY.get(key);
        if (!question) continue;
        // Store the exact wording alongside the answer, so a later revision of
        // the questionnaire never makes an old response ambiguous.
        insert.run(
          newId(),
          req.session.id,
          key,
          question.text,
          question.type === 'text' ? null : String(value),
          question.type === 'text' ? String(value).slice(0, 2000) : null,
          Number.isFinite(Number(req.body?.timings?.[key])) ? Number(req.body.timings[key]) : null
        );
      }
    });

    const updated = updateSession(req.session.id, { stage: 'debrief' });
    res.status(201).json({ session: publicSession(updated) });
  })
);

// ---------------------------------------------------------------------------
// Debrief
// ---------------------------------------------------------------------------

/**
 * GET /api/issues/debrief
 * The only endpoint that names the foils. It is served after rating is done, so
 * the disclosure cannot contaminate the ratings it is disclosing.
 */
issuesRouter.get(
  '/debrief',
  requireSession,
  asyncHandler(async (req, res) => {
    if (!['rated', 'completed'].includes(req.session.status)) {
      throw forbidden('The debrief is available once you have rated the issues.');
    }

    const payload = debriefPayload(req.session.id);
    res.json({
      ...payload,
      participantCode: req.session.participant_code,
    });
  })
);

/** POST /api/issues/debrief/viewed — marks the study complete. */
issuesRouter.post(
  '/debrief/viewed',
  requireSession,
  asyncHandler(async (req, res) => {
    const db = getDb();

    db.prepare(
      `INSERT INTO debrief_views (id, session_id, foils_revealed, day_shown, duration_ms)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      newId(),
      req.session.id,
      req.body?.foilsRevealed ? 1 : 0,
      req.body?.dayShown ? 1 : 0,
      Number.isFinite(Number(req.body?.durationMs)) ? Number(req.body.durationMs) : null
    );

    const startedAt = new Date(`${String(req.session.started_at).replace(' ', 'T')}Z`).getTime();
    const totalMs = Number.isFinite(startedAt) ? Date.now() - startedAt : null;

    db.prepare(
      `UPDATE sessions
       SET status = 'completed', stage = 'complete',
           completed_at = datetime('now'), total_duration_ms = ?
       WHERE id = ?`
    ).run(totalMs, req.session.id);

    res.json({ completed: true, participantCode: req.session.participant_code });
  })
);
