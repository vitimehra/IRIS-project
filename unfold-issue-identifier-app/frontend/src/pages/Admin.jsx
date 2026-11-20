import { useCallback, useEffect, useState } from "react";
import { Header, Footer } from "../components/Layout.jsx";
import { TextInput, Callout, Button } from "../components/Field.jsx";
import AnalysisTab, { Stat } from "./admin/AnalysisTab.jsx";
import IssuesTab from "./admin/IssuesTab.jsx";
import ParticipantLog, {
  DeleteControls,
  formatTime,
} from "./admin/ParticipantLog.jsx";
import { api } from "../api/client.js";

const ADMIN_TOKEN_KEY = "unfold.admin.token";

function readToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token) {
  try {
    // sessionStorage, not localStorage: a researcher token dies with the tab
    // rather than sitting on a shared lab machine.
    if (token) sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    else sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

const EXPORT_TABLES = [
  "sessions",
  "demographics",
  "consent_records",
  "consent_items",
  "guardian_requests",
  "game_sessions",
  "episodes",
  "episode_tags",
  "saboteur_rounds",
  "saboteur_responses",
  "pairwise_rounds",
  "extraction_runs",
  "issues",
  "issue_ratings",
  "post_questionnaire_responses",
  "telemetry_events",
  "withdrawals",
];

export default function Admin() {
  const [token, setToken] = useState(readToken());
  const [user, setUser] = useState(null);

  const shell = (children) => (
    <div className="app-shell">
      <Header showCode={false} />
      <main id="main" className="page">
        {children}
      </main>
      <Footer />
    </div>
  );

  useEffect(() => {
    if (!token) return;
    api
      .adminMe(token)
      .then((r) => setUser(r.user))
      .catch(() => {
        writeToken(null);
        setToken(null);
      });
  }, [token]);

  const onLoggedIn = (nextToken, nextUser) => {
    writeToken(nextToken);
    setToken(nextToken);
    setUser(nextUser);
  };

  const logout = async () => {
    try {
      await api.adminLogout(token);
    } catch {
      /* the token is being discarded either way */
    }
    writeToken(null);
    setToken(null);
    setUser(null);
  };

  if (!token || !user) return shell(<AdminLogin onLoggedIn={onLoggedIn} />);
  return shell(<Dashboard token={token} user={user} onLogout={logout} />);
}

function AdminLogin({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.adminLogin(
        username.trim().toLowerCase(),
        password,
      );
      onLoggedIn(result.token, result.user);
    } catch (err) {
      setError(err.message || "Login failed.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack-lg" style={{ maxWidth: "24rem" }}>
      <div>
        <p className="eyebrow">Researchers only</p>
        <h1>Sign in</h1>
      </div>

      <TextInput
        label="Username"
        value={username}
        onChange={setUsername}
        autoComplete="username"
        autoCapitalize="none"
      />

      <div className="field">
        <label className="field__label" htmlFor="admin-password">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>

      {error && (
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      )}

      <button
        type="submit"
        className="btn btn--primary"
        disabled={busy || !username || !password}
      >
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

function Dashboard({ token, user, onLogout }) {
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [corpus, setCorpus] = useState([]);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("overview");
  const [openedId, setOpenedId] = useState(null);
  const [log, setLog] = useState(null);
  const [logLoading, setLogLoading] = useState(false);
  const [deletePrompt, setDeletePrompt] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, list, auditLog, an, iss] = await Promise.all([
        api.adminStats(token),
        api.adminSessions(token, { limit: 200 }),
        api.adminAudit(token, 50),
        api.adminAnalysis(token),
        api.adminIssues(token, { limit: 300, foils: true }),
      ]);
      setStats(s);
      setSessions(list.sessions);
      setAudit(auditLog.entries);
      setAnalysis(an);
      setCorpus(iss.issues);
    } catch (err) {
      setError(err.message || "Could not load the dashboard.");
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const openSession = async (id) => {
    setTab("sessions");
    setOpenedId(id);
    setLog(null);
    setDeletePrompt(null);
    setLogLoading(true);
    setError(null);
    try {
      const result = await api.adminSessionLog(token, id);
      setLog(result);
    } catch (err) {
      setError(err.message || "Could not load this participant.");
      setOpenedId(null);
    } finally {
      setLogLoading(false);
    }
  };

  const closeSession = () => {
    setOpenedId(null);
    setLog(null);
    setDeletePrompt(null);
  };

  const runDelete = async (sessionId, action) => {
    if (action === "start") {
      const row = sessions.find((s) => s.id === sessionId) || log?.session;
      setDeletePrompt({
        id: sessionId,
        code: row?.participant_code || row?.participantCode,
        step: 1,
      });
      return;
    }
    if (action === "again") {
      setDeletePrompt((current) => (current ? { ...current, step: 2 } : null));
      return;
    }
    if (action === "cancel") {
      setDeletePrompt(null);
      return;
    }
    if (action !== "confirm" || !deletePrompt) return;

    setDeleteBusy(true);
    setError(null);
    try {
      await api.adminDeleteSession(token, deletePrompt.id);
      setDeletePrompt(null);
      if (openedId === deletePrompt.id) closeSession();
      await load();
    } catch (err) {
      setError(err.message || "Could not delete this participant.");
    } finally {
      setDeleteBusy(false);
    }
  };

  /**
   * Exports are authenticated downloads, so they cannot be a plain link: the
   * browser would not attach the bearer token. Fetch, then hand the blob over.
   */
  const download = async (url, filename) => {
    try {
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="stack-lg">
      <div className="btn-row btn-row--split">
        <div>
          <p className="eyebrow">Experimenter dashboard</p>
          <h1 style={{ fontSize: "var(--step-3)" }}>{user.displayName}</h1>
        </div>
        <Button variant="ghost" onClick={onLogout}>
          Sign out
        </Button>
      </div>

      {error && (
        <Callout tone="warn">
          <p role="alert" style={{ marginBottom: 0 }}>
            {error}
          </p>
        </Callout>
      )}

      <div className="btn-row" role="tablist">
        {[
          ["overview", "Overview"],
          ["sessions", "Participants"],
          ["analysis", "Analysis"],
          ["issues", "Issues"],
          ["export", "Export"],
          ["audit", "Access log"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={`btn ${tab === key ? "btn--primary" : "btn--ghost"}`}
            onClick={() => {
              setTab(key);
              if (key !== "sessions") closeSession();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && stats && (
        <div className="stack">
          <div className="stat-grid">
            <Stat label="Sessions started" value={stats.sessions.total} />
            <Stat label="Consented" value={stats.sessions.consented} />
            <Stat label="Completed" value={stats.sessions.completed} />
            <Stat
              label="Demographics in"
              value={stats.demographics.submitted}
            />
            <Stat label="Under 18" value={stats.sessions.minors} />
            <Stat label="Screened out" value={stats.sessions.screenedOut} />
            <Stat label="Withdrawn" value={stats.sessions.withdrawn} />
            <Stat label="Issues extracted" value={stats.issues.extracted} />
          </div>

          <section className="card stack-sm">
            <h2 style={{ fontSize: "var(--step-1)" }}>Guardian consent</h2>
            <p style={{ marginBottom: 0 }}>
              {stats.guardian.requested} requested · {stats.guardian.consented}{" "}
              granted · {stats.guardian.declined} declined
            </p>
          </section>

          <section className="card stack-sm">
            <h2 style={{ fontSize: "var(--step-1)" }}>Where sessions stop</h2>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.funnel.map((row) => (
                    <tr key={row.status}>
                      <td>{row.status}</td>
                      <td>{row.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {tab === "sessions" && openedId && (
        <div className="stack">
          {logLoading && <p className="muted">Loading participant log…</p>}
          {log && (
            <ParticipantLog
              log={log}
              onBack={closeSession}
              deletePrompt={deletePrompt?.id === openedId ? deletePrompt : null}
              busy={deleteBusy}
              onDelete={(action) => runDelete(openedId, action)}
            />
          )}
        </div>
      )}

      {tab === "sessions" && !openedId && (
        <div className="stack">
          <p className="muted" style={{ marginBottom: 0 }}>
            Open any participant, at any stage, to read their full log. Delete
            removes every row of theirs and cannot be undone.
          </p>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Age</th>
                  <th>Minor</th>
                  <th>Gender</th>
                  <th>Field</th>
                  <th>Issues</th>
                  <th>Rated</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={11} className="faint">
                      No participants yet.
                    </td>
                  </tr>
                )}
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <code>{s.participant_code}</code>
                    </td>
                    <td>
                      <span className={`tag ${statusTone(s.status)}`}>
                        {s.status}
                      </span>
                    </td>
                    <td>{s.stage}</td>
                    <td>{s.age ?? s.declared_age ?? "—"}</td>
                    <td>{s.is_minor ? "yes" : ""}</td>
                    <td>{s.gender ?? "—"}</td>
                    <td>{s.occupation_category ?? "—"}</td>
                    <td>{s.issue_count}</td>
                    <td>{s.rating_count}</td>
                    <td>{formatTime(s.started_at)}</td>
                    <td className="table-actions">
                      <div className="btn-row">
                        <Button
                          variant="ghost"
                          onClick={() => openSession(s.id)}
                        >
                          Open
                        </Button>
                        {s.status === "withdrawn" ? (
                          <span className="faint">Deleted</span>
                        ) : deletePrompt?.id === s.id ? (
                          <DeleteControls
                            prompt={deletePrompt}
                            code={s.participant_code}
                            busy={deleteBusy}
                            onStart={() => runDelete(s.id, "start")}
                            onAgain={() => runDelete(s.id, "again")}
                            onConfirm={() => runDelete(s.id, "confirm")}
                            onCancel={() => runDelete(s.id, "cancel")}
                          />
                        ) : (
                          <Button
                            variant="danger"
                            onClick={() => runDelete(s.id, "start")}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "analysis" && analysis && <AnalysisTab analysis={analysis} />}

      {tab === "issues" && <IssuesTab issues={corpus} />}

      {tab === "export" && (
        <div className="stack">
          <Callout>
            <p style={{ marginBottom: 0 }}>
              Withdrawn participants are excluded from every export. Each
              download is written to the access log with your name against it.
            </p>
          </Callout>

          <section className="card stack-sm">
            <h2 style={{ fontSize: "var(--step-1)" }}>Everything, as JSON</h2>
            <p>
              One file, every table, with the schema version recorded in it.
            </p>
            <Button
              variant="accent"
              onClick={() =>
                download(
                  api.adminExportUrl(),
                  `unfold-export-${new Date().toISOString().slice(0, 10)}.json`,
                )
              }
            >
              Download full export
            </Button>
          </section>

          <section className="card stack-sm">
            <h2 style={{ fontSize: "var(--step-1)" }}>Single tables, as CSV</h2>
            <div className="btn-row">
              {EXPORT_TABLES.map((table) => (
                <Button
                  key={table}
                  variant="ghost"
                  onClick={() =>
                    download(api.adminCsvUrl(table), `unfold-${table}.csv`)
                  }
                >
                  {table}
                </Button>
              ))}
            </div>
          </section>
        </div>
      )}

      {tab === "audit" && (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatTime(entry.created_at)}</td>
                  <td>{entry.actor_label}</td>
                  <td>{entry.action}</td>
                  <td>
                    {entry.target_id ? (
                      <code>{entry.target_id.slice(0, 8)}…</code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function statusTone(status) {
  if (status === "completed") return "tag--ok";
  if (status === "withdrawn" || status === "screened_out") return "tag--bad";
  if (status === "started" || status === "awaiting_guardian")
    return "tag--warn";
  return "";
}
