import { Router } from 'express';
import { getDb, transact } from '../db/index.js';
import { newId } from '../services/ids.js';
import { publicSession, updateSession } from '../services/sessions.js';
import { requireSession } from '../middleware/auth.js';
import { asyncHandler, badRequest, forbidden, notFoundError } from '../middleware/errors.js';
import {
  GAME_CONTENT_VERSION,
  EMOTION_TOKENS,
  NEGATIVE_TOKENS,
  TIME_BANDS,
  DOMAINS,
  EPISODE_TEMPLATES,
  selectStarterEpisodes,
  saboteurPromptFor,
  buildPairs,
  SABOTEUR_MAX_ROUNDS,
  SABOTEUR_RESPONSES_PER_ROUND,
  PAIRWISE_MAX_ROUNDS,
} from '../content/game.js';

export const gameRouter = Router();

const TOKEN_KEYS = new Set(EMOTION_TOKENS.map((t) => t.key));
const BAND_KEYS = new Set(TIME_BANDS.map((b) => b.key));
const DOMAIN_KEYS = new Set(DOMAINS.map((d) => d.key));

function requireConsented(session) {
  const ok = ['consented', 'demographics_done', 'game_done', 'rated'].includes(session.status);
  if (!ok) throw forbidden('Consent and background questions must be completed first.');
}

function currentGame(sessionId) {
  return getDb()
    .prepare(`SELECT * FROM game_sessions WHERE session_id = ? ORDER BY started_at DESC LIMIT 1`)
    .get(sessionId);
}

function requireGame(sessionId) {
  const game = currentGame(sessionId);
  if (!game) throw notFoundError('No game session. Start one first.');
  return game;
}

function loadEpisodes(gameId) {
  const db = getDb();
  const episodes = db
    .prepare(`SELECT * FROM episodes WHERE game_session_id = ? ORDER BY ordinal`)
    .all(gameId);
  const tagStmt = db.prepare(`SELECT token_key, intensity FROM episode_tags WHERE episode_id = ?`);
  return episodes.map((e) => ({
    id: e.id,
    ordinal: e.ordinal,
    timeBand: e.time_band,
    domain: e.domain,
    label: e.label,
    description: e.description,
    source: e.source,
    templateId: e.template_id,
    wasEdited: Boolean(e.was_edited),
    tags: tagStmt.all(e.id).map((t) => t.token_key),
  }));
}

/** GET /api/game/content — tokens, bands, domains, and the template catalogue. */
gameRouter.get(
  '/content',
  asyncHandler(async (_req, res) => {
    res.json({
      version: GAME_CONTENT_VERSION,
      tokens: EMOTION_TOKENS,
      timeBands: TIME_BANDS,
      domains: DOMAINS,
      // The catalogue lets the participant add a suggested episode they removed
      // earlier, without a round trip per suggestion.
      templates: EPISODE_TEMPLATES.map((t) => ({
        id: t.id,
        timeBand: t.band,
        domain: t.domain,
        label: t.label,
        description: t.description,
      })),
      limits: {
        saboteurRounds: SABOTEUR_MAX_ROUNDS,
        saboteurResponses: SABOTEUR_RESPONSES_PER_ROUND,
        pairwiseRounds: PAIRWISE_MAX_ROUNDS,
      },
    });
  })
);

/**
 * POST /api/game/start
 * Seeds a starter day from the participant's own background, then hands it over
 * for them to correct. Suggesting beats a blank board: a blank board produces
 * four episodes and a thin day.
 */
gameRouter.post(
  '/start',
  requireSession,
  asyncHandler(async (req, res) => {
    requireConsented(req.session);

    const existing = currentGame(req.session.id);
    if (existing && !existing.ended_at) {
      return res.json({
        game: {
          id: existing.id,
          anchorDate: existing.anchor_date,
          anchorDayOfWeek: existing.anchor_day_of_week,
          anchorIsTypical: existing.anchor_is_typical,
        },
        episodes: loadEpisodes(existing.id),
        resumed: true,
      });
    }

    const { anchorDate, anchorIsTypical } = req.body || {};
    const demographics =
      getDb().prepare(`SELECT * FROM demographics WHERE session_id = ?`).get(req.session.id) || {};

    const date = anchorDate ? new Date(anchorDate) : new Date(Date.now() - 86400000);
    const dayOfWeek = Number.isNaN(date.getTime())
      ? null
      : date.toLocaleDateString('en-GB', { weekday: 'long' });

    const gameId = newId();
    const starters = selectStarterEpisodes(demographics);

    transact(() => {
      const db = getDb();
      db.prepare(
        `INSERT INTO game_sessions (
           id, session_id, anchor_date, anchor_day_of_week, anchor_is_typical,
           config_json, content_version
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        gameId,
        req.session.id,
        Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10),
        dayOfWeek,
        anchorIsTypical === false ? 0 : 1,
        JSON.stringify({ starterCount: starters.length, tokens: EMOTION_TOKENS.map((t) => t.key) }),
        GAME_CONTENT_VERSION
      );

      const insert = db.prepare(
        `INSERT INTO episodes (
           id, game_session_id, ordinal, time_band, domain, label, description, source, template_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const episode of starters) {
        insert.run(
          newId(),
          gameId,
          episode.ordinal,
          episode.timeBand,
          episode.domain,
          episode.label,
          episode.description,
          'template',
          episode.templateId
        );
      }
    });

    updateSession(req.session.id, { stage: 'game' });

    res.status(201).json({
      game: {
        id: gameId,
        anchorDate: Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10),
        anchorDayOfWeek: dayOfWeek,
        anchorIsTypical: anchorIsTypical === false ? 0 : 1,
      },
      episodes: loadEpisodes(gameId),
      resumed: false,
    });
  })
);

/** GET /api/game/state */
gameRouter.get(
  '/state',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = currentGame(req.session.id);
    if (!game) return res.json({ game: null, episodes: [] });
    res.json({
      game: {
        id: game.id,
        anchorDate: game.anchor_date,
        anchorDayOfWeek: game.anchor_day_of_week,
        anchorIsTypical: game.anchor_is_typical,
        endedAt: game.ended_at,
      },
      episodes: loadEpisodes(game.id),
    });
  })
);

/** POST /api/game/episodes — add one the participant wrote themselves. */
gameRouter.post(
  '/episodes',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const { label, description, timeBand, domain, templateId } = req.body || {};

    if (!label || String(label).trim().length < 2) throw badRequest('Give the moment a short name.');
    if (!BAND_KEYS.has(timeBand)) throw badRequest('Unknown time band.');

    const db = getDb();
    const nextOrdinal =
      (db.prepare(`SELECT MAX(ordinal) m FROM episodes WHERE game_session_id = ?`).get(game.id).m ??
        -1) + 1;

    const id = newId();
    db.prepare(
      `INSERT INTO episodes (
         id, game_session_id, ordinal, time_band, domain, label, description, source, template_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      game.id,
      nextOrdinal,
      timeBand,
      DOMAIN_KEYS.has(domain) ? domain : null,
      String(label).trim().slice(0, 140),
      description ? String(description).trim().slice(0, 500) : null,
      templateId ? 'template' : 'participant',
      templateId || null
    );

    res.status(201).json({ episodes: loadEpisodes(game.id) });
  })
);

/** PATCH /api/game/episodes/:id */
gameRouter.patch(
  '/episodes/:id',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const db = getDb();

    const episode = db
      .prepare(`SELECT * FROM episodes WHERE id = ? AND game_session_id = ?`)
      .get(req.params.id, game.id);
    if (!episode) throw notFoundError('No such episode.');

    const { label, description, timeBand, domain } = req.body || {};
    db.prepare(
      `UPDATE episodes
       SET label = COALESCE(?, label),
           description = COALESCE(?, description),
           time_band = COALESCE(?, time_band),
           domain = COALESCE(?, domain),
           was_edited = 1
       WHERE id = ?`
    ).run(
      label ? String(label).trim().slice(0, 140) : null,
      description !== undefined ? String(description || '').slice(0, 500) : null,
      BAND_KEYS.has(timeBand) ? timeBand : null,
      DOMAIN_KEYS.has(domain) ? domain : null,
      episode.id
    );

    res.json({ episodes: loadEpisodes(game.id) });
  })
);

/** DELETE /api/game/episodes/:id */
gameRouter.delete(
  '/episodes/:id',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const result = getDb()
      .prepare(`DELETE FROM episodes WHERE id = ? AND game_session_id = ?`)
      .run(req.params.id, game.id);
    if (result.changes === 0) throw notFoundError('No such episode.');
    res.json({ episodes: loadEpisodes(game.id) });
  })
);

/** PUT /api/game/episodes/:id/tags — replaces the tag set for one episode. */
gameRouter.put(
  '/episodes/:id/tags',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const db = getDb();

    const episode = db
      .prepare(`SELECT * FROM episodes WHERE id = ? AND game_session_id = ?`)
      .get(req.params.id, game.id);
    if (!episode) throw notFoundError('No such episode.');

    const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    const invalid = tokens.filter((t) => !TOKEN_KEYS.has(t));
    if (invalid.length) throw badRequest(`Unknown emotion tokens: ${invalid.join(', ')}`);

    transact(() => {
      db.prepare(`DELETE FROM episode_tags WHERE episode_id = ?`).run(episode.id);
      const insert = db.prepare(
        `INSERT INTO episode_tags (id, episode_id, token_key, is_negative) VALUES (?, ?, ?, ?)`
      );
      for (const token of tokens) {
        insert.run(newId(), episode.id, token, NEGATIVE_TOKENS.includes(token) ? 1 : 0);
      }
    });

    res.json({ episodes: loadEpisodes(game.id) });
  })
);

/**
 * POST /api/game/saboteur/plan
 * Chooses which episodes get a Saboteur round: the most negatively tagged
 * first, since those carry the most friction per question asked.
 */
gameRouter.post(
  '/saboteur/plan',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const db = getDb();

    const existing = db
      .prepare(`SELECT * FROM saboteur_rounds WHERE game_session_id = ? ORDER BY ordinal`)
      .all(game.id);
    if (existing.length > 0) {
      return res.json({
        rounds: existing.map((r) => ({
          id: r.id,
          episodeId: r.episode_id,
          promptText: r.prompt_text,
          ordinal: r.ordinal,
          skipped: Boolean(r.skipped),
        })),
        resumed: true,
      });
    }

    const candidates = db
      .prepare(
        `SELECT e.*, COUNT(t.id) AS negative_count
         FROM episodes e
         JOIN episode_tags t ON t.episode_id = e.id AND t.is_negative = 1
         WHERE e.game_session_id = ?
         GROUP BY e.id
         ORDER BY negative_count DESC, e.ordinal ASC
         LIMIT ?`
      )
      .all(game.id, SABOTEUR_MAX_ROUNDS);

    const rounds = [];
    transact(() => {
      const insert = db.prepare(
        `INSERT INTO saboteur_rounds (id, game_session_id, episode_id, ordinal, prompt_key, prompt_text)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      candidates.forEach((episode, index) => {
        const prompt = saboteurPromptFor(episode, index);
        const id = newId();
        insert.run(id, game.id, episode.id, index, prompt.key, prompt.text);
        rounds.push({ id, episodeId: episode.id, promptText: prompt.text, ordinal: index, skipped: false });
      });
    });

    res.status(201).json({ rounds, resumed: false });
  })
);

/** POST /api/game/saboteur/:roundId/responses */
gameRouter.post(
  '/saboteur/:roundId/responses',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const db = getDb();

    const round = db
      .prepare(`SELECT * FROM saboteur_rounds WHERE id = ? AND game_session_id = ?`)
      .get(req.params.roundId, game.id);
    if (!round) throw notFoundError('No such round.');

    const { responses, skipped } = req.body || {};

    transact(() => {
      db.prepare(`DELETE FROM saboteur_responses WHERE saboteur_round_id = ?`).run(round.id);

      const insert = db.prepare(
        `INSERT INTO saboteur_responses (id, saboteur_round_id, ordinal, response_text, response_ms)
         VALUES (?, ?, ?, ?, ?)`
      );

      (Array.isArray(responses) ? responses : [])
        .slice(0, SABOTEUR_RESPONSES_PER_ROUND)
        .forEach((response, index) => {
          const text = String(response?.text ?? response ?? '').trim();
          if (!text) return;
          insert.run(
            newId(),
            round.id,
            index,
            text.slice(0, 1000),
            // Latency is signal: an answer given in four seconds is a lived
            // one, an answer given in forty is usually invented.
            Number.isFinite(Number(response?.responseMs)) ? Number(response.responseMs) : null
          );
        });

      db.prepare(
        `UPDATE saboteur_rounds SET ended_at = datetime('now'), skipped = ? WHERE id = ?`
      ).run(skipped ? 1 : 0, round.id);
    });

    res.status(201).json({ saved: true });
  })
);

/**
 * POST /api/game/pairwise/plan
 * Forced choice among the episodes they tagged negatively. Yields a severity
 * ranking without asking anybody to rate anything.
 */
gameRouter.post(
  '/pairwise/plan',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const db = getDb();

    const existing = db
      .prepare(`SELECT * FROM pairwise_rounds WHERE game_session_id = ? ORDER BY ordinal`)
      .all(game.id);
    if (existing.length > 0) {
      return res.json({ rounds: existing.map(publicPair), resumed: true });
    }

    const negativeEpisodes = db
      .prepare(
        `SELECT DISTINCT e.id, e.label
         FROM episodes e
         JOIN episode_tags t ON t.episode_id = e.id AND t.is_negative = 1
         WHERE e.game_session_id = ?
         ORDER BY e.ordinal`
      )
      .all(game.id);

    const pairs = buildPairs(negativeEpisodes);
    const rounds = [];

    transact(() => {
      const insert = db.prepare(
        `INSERT INTO pairwise_rounds (
           id, game_session_id, ordinal, left_ref_type, left_ref_id, left_text,
           right_ref_type, right_ref_id, right_text
         ) VALUES (?, ?, ?, 'episode', ?, ?, 'episode', ?, ?)`
      );
      pairs.forEach((pair, index) => {
        const id = newId();
        insert.run(id, game.id, index, pair.left.id, pair.left.label, pair.right.id, pair.right.label);
        rounds.push({
          id,
          ordinal: index,
          left: { id: pair.left.id, text: pair.left.label },
          right: { id: pair.right.id, text: pair.right.label },
          chosenSide: null,
        });
      });
    });

    res.status(201).json({ rounds, resumed: false });
  })
);

function publicPair(row) {
  return {
    id: row.id,
    ordinal: row.ordinal,
    left: { id: row.left_ref_id, text: row.left_text },
    right: { id: row.right_ref_id, text: row.right_text },
    chosenSide: row.chosen_side,
  };
}

/** POST /api/game/pairwise/:roundId/choice */
gameRouter.post(
  '/pairwise/:roundId/choice',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);
    const { chosenSide, responseMs } = req.body || {};

    if (!['left', 'right', 'skipped'].includes(chosenSide)) {
      throw badRequest('chosenSide must be left, right or skipped.');
    }

    const result = getDb()
      .prepare(
        `UPDATE pairwise_rounds SET chosen_side = ?, response_ms = ?
         WHERE id = ? AND game_session_id = ?`
      )
      .run(
        chosenSide,
        Number.isFinite(Number(responseMs)) ? Number(responseMs) : null,
        req.params.roundId,
        game.id
      );

    if (result.changes === 0) throw notFoundError('No such round.');
    res.json({ saved: true });
  })
);

/** POST /api/game/complete */
gameRouter.post(
  '/complete',
  requireSession,
  asyncHandler(async (req, res) => {
    const game = requireGame(req.session.id);

    getDb()
      .prepare(
        `UPDATE game_sessions
         SET ended_at = datetime('now'),
             duration_ms = ?
         WHERE id = ?`
      )
      .run(Number.isFinite(Number(req.body?.durationMs)) ? Number(req.body.durationMs) : null, game.id);

    const updated = updateSession(req.session.id, { status: 'game_done', stage: 'rating' });
    res.json({ session: publicSession(updated) });
  })
);
