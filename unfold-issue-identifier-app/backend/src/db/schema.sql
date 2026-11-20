-- UNFOLD :: full schema for all six phases.
-- Written once, up front, so Phase 2-6 work never rewrites existing participant rows.
-- Every table holding participant data cascades from `sessions`, which is what lets a
-- withdrawal hard-delete run as a single statement.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 0. Meta
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS schema_meta (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------------------------------------------------------------------------
-- 1. Session spine
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id                  TEXT PRIMARY KEY,           -- uuid v4, anonymous
  participant_code    TEXT UNIQUE,                -- readable P001.. for linking to interviews
  status              TEXT NOT NULL DEFAULT 'started',
      -- started | age_gated | awaiting_guardian | consented | demographics_done
      -- | game_done | rated | completed | withdrawn | screened_out
  stage               TEXT NOT NULL DEFAULT 'landing',
  is_minor            INTEGER NOT NULL DEFAULT 0,
  declared_age        INTEGER,
  llm_enabled         INTEGER NOT NULL DEFAULT 1,
  study_arm           TEXT,                       -- reserved: future between-subject conditions
  user_agent          TEXT,
  ip_hash             TEXT,                       -- salted hash, never the raw address
  screen_w            INTEGER,
  screen_h            INTEGER,
  device_pixel_ratio  REAL,
  timezone            TEXT,
  locale              TEXT,
  referrer            TEXT,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at        TEXT,
  completed_at        TEXT,
  withdrawn_at        TEXT,
  total_duration_ms   INTEGER,
  notes               TEXT                        -- researcher annotation, added via admin
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);

-- Bearer tokens are stored hashed. The plaintext lives only in the browser, so a
-- database leak does not let anyone resume a session.
CREATE TABLE IF NOT EXISTS session_tokens (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_session_tokens_session ON session_tokens(session_id);

-- ---------------------------------------------------------------------------
-- 2. Age gate and consent
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS age_gate_responses (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  declared_age  INTEGER NOT NULL,
  result        TEXT NOT NULL,                    -- adult | minor | screened_out
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consent_records (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  consent_type      TEXT NOT NULL,                -- adult | minor_assent | guardian
  document_version  TEXT NOT NULL,
  agreed            INTEGER NOT NULL,
  signature_name    TEXT,
  agreed_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ip_hash           TEXT,
  user_agent        TEXT,
  withdrawn_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_consent_session ON consent_records(session_id);

-- One row per checkbox, storing the exact text shown. If the consent document is
-- ever revised, historical records stay interpretable.
CREATE TABLE IF NOT EXISTS consent_items (
  id                 TEXT PRIMARY KEY,
  consent_record_id  TEXT NOT NULL REFERENCES consent_records(id) ON DELETE CASCADE,
  item_key           TEXT NOT NULL,
  item_text          TEXT NOT NULL,
  required           INTEGER NOT NULL DEFAULT 1,
  response           INTEGER NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_consent_items_record ON consent_items(consent_record_id);

-- The 15-17 handoff. The guardian acts on their own device, which is what makes
-- this a defensible consent record rather than a checkbox the teenager ticked.
CREATE TABLE IF NOT EXISTS guardian_requests (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  short_code            TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'pending',  -- pending | viewed | consented | declined | expired
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at            TEXT NOT NULL,
  first_viewed_at       TEXT,
  resolved_at           TEXT,
  guardian_name         TEXT,
  guardian_relationship TEXT,
  guardian_contact      TEXT,
  guardian_ip_hash      TEXT,
  guardian_user_agent   TEXT,
  decline_reason        TEXT
);

CREATE INDEX IF NOT EXISTS idx_guardian_session ON guardian_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_guardian_code ON guardian_requests(short_code);

-- ---------------------------------------------------------------------------
-- 3. Demographics
-- ---------------------------------------------------------------------------
-- Mapped columns for analysis, plus raw_payload holding the verbatim submission.
-- If a field is added later, no historical row is lost: it is already in the JSON.

CREATE TABLE IF NOT EXISTS demographics (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,

  first_name                TEXT,                 -- optional, first name only
  age                       INTEGER,
  age_band                  TEXT,
  gender                    TEXT,
  gender_self_described     TEXT,

  country                   TEXT,
  state_region              TEXT,
  city                      TEXT,
  settlement_type           TEXT,                 -- metro | tier2_city | town | rural

  education_level           TEXT,
  occupation_category       TEXT,
  occupation_title          TEXT,
  employment_status         TEXT,
  work_arrangement          TEXT,                 -- onsite | hybrid | remote | na
  work_hours_per_week       INTEGER,
  student_status            TEXT,

  household_size            INTEGER,
  household_composition     TEXT,
  marital_status            TEXT,
  has_children              INTEGER,
  children_count            INTEGER,
  caregiving_responsibility TEXT,                 -- none | children | elders | both | other

  income_band               TEXT,
  income_confidence         TEXT,                 -- how comfortably they manage, not just amount
  housing_type              TEXT,
  domestic_help             TEXT,

  primary_transport         TEXT,
  commute_minutes_each_way  INTEGER,

  smartphone_os             TEXT,
  daily_screen_hours        REAL,
  internet_reliability      TEXT,
  tech_comfort              TEXT,

  health_conditions_affect_routine INTEGER,
  accessibility_needs       TEXT,

  primary_language          TEXT,
  languages_spoken          TEXT,

  raw_payload               TEXT NOT NULL,        -- verbatim JSON of everything submitted
  completed_steps           INTEGER,
  duration_ms               INTEGER,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT
);

-- ---------------------------------------------------------------------------
-- 4. Game (Phase 2)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS game_sessions (
  id                 TEXT PRIMARY KEY,
  session_id         TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  anchor_date        TEXT,                        -- the real day being reconstructed
  anchor_day_of_week TEXT,
  anchor_is_typical  INTEGER,
  config_json        TEXT,                        -- domains sampled, token set, version
  content_version    TEXT,
  started_at         TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at           TEXT,
  duration_ms        INTEGER,
  abandoned          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_session ON game_sessions(session_id);

CREATE TABLE IF NOT EXISTS episodes (
  id               TEXT PRIMARY KEY,
  game_session_id  TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  ordinal          INTEGER NOT NULL,
  time_band        TEXT,                          -- dawn | morning | midday | afternoon | evening | night
  start_time       TEXT,
  end_time         TEXT,
  domain           TEXT,
  label            TEXT,
  description      TEXT,
  source           TEXT NOT NULL DEFAULT 'template',  -- template | participant
  template_id      TEXT,
  was_edited       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episodes_game ON episodes(game_session_id);

CREATE TABLE IF NOT EXISTS episode_tags (
  id           TEXT PRIMARY KEY,
  episode_id   TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  token_key    TEXT NOT NULL,                     -- rushed | waiting | stuck | ...
  intensity    INTEGER,
  is_negative  INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episode_tags_episode ON episode_tags(episode_id);

-- The Saboteur: make this moment worse. Reverse-brainstorming, fired at
-- negatively tagged episodes.
CREATE TABLE IF NOT EXISTS saboteur_rounds (
  id               TEXT PRIMARY KEY,
  game_session_id  TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  episode_id       TEXT REFERENCES episodes(id) ON DELETE CASCADE,
  ordinal          INTEGER,
  prompt_key       TEXT,
  prompt_text      TEXT,
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT,
  skipped          INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_saboteur_game ON saboteur_rounds(game_session_id);

CREATE TABLE IF NOT EXISTS saboteur_responses (
  id                 TEXT PRIMARY KEY,
  saboteur_round_id  TEXT NOT NULL REFERENCES saboteur_rounds(id) ON DELETE CASCADE,
  ordinal            INTEGER NOT NULL,
  response_text      TEXT NOT NULL,
  response_ms        INTEGER,                     -- latency is signal: fast answers are lived ones
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_saboteur_responses_round ON saboteur_responses(saboteur_round_id);

-- Forced choice: which of these two would you pay to delete. Yields a ranking
-- without asking anyone to rate anything.
CREATE TABLE IF NOT EXISTS pairwise_rounds (
  id               TEXT PRIMARY KEY,
  game_session_id  TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  ordinal          INTEGER NOT NULL,
  left_ref_type    TEXT NOT NULL,                 -- episode | saboteur_response | issue
  left_ref_id      TEXT NOT NULL,
  left_text        TEXT,
  right_ref_type   TEXT NOT NULL,
  right_ref_id     TEXT NOT NULL,
  right_text       TEXT,
  chosen_side      TEXT,                          -- left | right | skipped
  response_ms      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pairwise_game ON pairwise_rounds(game_session_id);

-- ---------------------------------------------------------------------------
-- 5. Extraction and issues (Phase 3)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS extraction_runs (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  model             TEXT NOT NULL,
  prompt_version    TEXT NOT NULL,
  status            TEXT NOT NULL,                -- pending | ok | error | fallback
  request_json      TEXT,                         -- exactly what was sent
  response_json     TEXT,                         -- exactly what came back
  input_tokens      INTEGER,
  output_tokens     INTEGER,
  latency_ms        INTEGER,
  error_message     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_extraction_session ON extraction_runs(session_id);

-- One row per CAE atom. Atom level is "the geyser takes 12 minutes to heat":
-- three atoms out of one episode become three rows, and three rated cards.
CREATE TABLE IF NOT EXISTS issues (
  id                    TEXT PRIMARY KEY,
  session_id            TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  extraction_run_id     TEXT REFERENCES extraction_runs(id) ON DELETE SET NULL,
  ordinal               INTEGER,

  headline              TEXT NOT NULL,            -- the atom, one sentence
  cause                 TEXT NOT NULL,
  cause_provenance      TEXT NOT NULL DEFAULT 'inferred',   -- participant | inferred
  affect                TEXT NOT NULL,
  affect_provenance     TEXT NOT NULL DEFAULT 'inferred',
  effect                TEXT NOT NULL,
  effect_provenance     TEXT NOT NULL DEFAULT 'inferred',

  domain                TEXT,
  time_band             TEXT,
  source_episode_id     TEXT REFERENCES episodes(id) ON DELETE SET NULL,
  source_evidence       TEXT,                     -- the participant text it was drawn from
  confidence            REAL,

  is_foil               INTEGER NOT NULL DEFAULT 0,
  foil_family           TEXT,                     -- which plausible-but-fabricated family
  shown_to_participant  INTEGER NOT NULL DEFAULT 0,
  display_rank          INTEGER,

  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_issues_session ON issues(session_id);
CREATE INDEX IF NOT EXISTS idx_issues_shown ON issues(session_id, shown_to_participant);

-- ---------------------------------------------------------------------------
-- 6. Rating, post-questionnaire, debrief (Phase 4)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS issue_ratings (
  id              TEXT PRIMARY KEY,
  issue_id        TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  severity        INTEGER,                        -- 1..5, null if rejected outright
  rejected        INTEGER NOT NULL DEFAULT 0,
  recognised      INTEGER,                        -- is this mine, asked before severity
  edited_headline TEXT,
  edited_cause    TEXT,
  edited_affect   TEXT,
  edited_effect   TEXT,
  edit_note       TEXT,
  response_ms     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(issue_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_session ON issue_ratings(session_id);

CREATE TABLE IF NOT EXISTS post_questionnaire_responses (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_key    TEXT NOT NULL,
  question_text   TEXT NOT NULL,
  response_value  TEXT,                           -- scale point or choice
  response_text   TEXT,                           -- free text
  response_ms     INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_postq_session ON post_questionnaire_responses(session_id);

CREATE TABLE IF NOT EXISTS debrief_views (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  viewed_at        TEXT NOT NULL DEFAULT (datetime('now')),
  foils_revealed   INTEGER NOT NULL DEFAULT 0,
  day_shown        INTEGER NOT NULL DEFAULT 0,
  duration_ms      INTEGER
);

-- ---------------------------------------------------------------------------
-- 7. Telemetry
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS telemetry_events (
  id            TEXT PRIMARY KEY,
  session_id    TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  page          TEXT,
  payload_json  TEXT,
  client_ts     TEXT,
  server_ts     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_events(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_type ON telemetry_events(event_type);

-- ---------------------------------------------------------------------------
-- 8. Withdrawal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS withdrawals (
  id                TEXT PRIMARY KEY,
  session_id        TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  participant_code  TEXT,                         -- kept after hard delete as an audit stub
  requested_at      TEXT NOT NULL DEFAULT (datetime('now')),
  reason            TEXT,
  method            TEXT,                         -- self_service | researcher | guardian
  hard_deleted_at   TEXT
);

-- ---------------------------------------------------------------------------
-- 9. Admin (Phase 5): two named accounts, with an access trail
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  email          TEXT,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'researcher',   -- researcher | owner
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at  TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id             TEXT PRIMARY KEY,
  admin_user_id  TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  ip_hash        TEXT,
  user_agent     TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(admin_user_id);

-- Deliberately NOT cascaded from sessions: if a participant is hard-deleted, the
-- record that someone exported or deleted them must survive.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             TEXT PRIMARY KEY,
  admin_user_id  TEXT REFERENCES admin_users(id) ON DELETE SET NULL,
  actor_label    TEXT,
  action         TEXT NOT NULL,
  target_type    TEXT,
  target_id      TEXT,
  details_json   TEXT,
  ip_hash        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_log(created_at);
