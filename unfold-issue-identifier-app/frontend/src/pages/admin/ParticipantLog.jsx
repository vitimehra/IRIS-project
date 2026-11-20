import { useState } from "react";
import { Button, Callout } from "../../components/Field.jsx";

export function formatTime(value) {
  if (value == null || value === "") return "—";
  const raw = String(value);
  const iso = raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleString();
}

function Empty({ children }) {
  return <p className="faint">{children}</p>;
}

function Kv({ data, skip = [] }) {
  if (!data) return <Empty>None.</Empty>;
  const hidden = new Set(["id", ...skip]);
  const entries = Object.entries(data).filter(([key, value]) => {
    if (hidden.has(key)) return false;
    if (value == null || value === "") return false;
    if (Array.isArray(value) || (typeof value === "object" && value !== null))
      return false;
    return true;
  });
  if (entries.length === 0) return <Empty>No fields recorded.</Empty>;
  return (
    <dl className="kv-grid">
      {entries.map(([key, value]) => (
        <div key={key} className="kv-grid__row">
          <dt>{key.replace(/_/g, " ")}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function JsonBlock({ value, label = "Raw data" }) {
  if (value == null) return null;
  return (
    <details className="log-json">
      <summary>{label}</summary>
      <pre>
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function Section({ title, children }) {
  return (
    <section className="card stack-sm log-section">
      <h2 style={{ fontSize: "var(--step-1)" }}>{title}</h2>
      {children}
    </section>
  );
}

export default function ParticipantLog({
  log,
  onBack,
  onDelete,
  deletePrompt,
  busy,
}) {
  const session = log.session;
  const withdrawn = session.status === "withdrawn";
  const code = session.participant_code;

  return (
    <div className="stack-lg participant-log">
      <div className="btn-row btn-row--split">
        <div>
          <p className="eyebrow">Participant log</p>
          <h2 style={{ fontSize: "var(--step-2)", margin: 0 }}>
            <code>{code}</code>
          </h2>
          <p className="muted" style={{ marginBottom: 0 }}>
            {session.status} · {session.stage}
            {session.started_at
              ? ` · started ${formatTime(session.started_at)}`
              : ""}
          </p>
        </div>
        <div className="btn-row">
          <Button variant="ghost" onClick={onBack}>
            Back to list
          </Button>
          {!withdrawn && (
            <DeleteControls
              prompt={deletePrompt}
              code={code}
              busy={busy}
              onStart={() => onDelete("start")}
              onAgain={() => onDelete("again")}
              onConfirm={() => onDelete("confirm")}
              onCancel={() => onDelete("cancel")}
            />
          )}
        </div>
      </div>

      {withdrawn && (
        <Callout tone="warn">
          <p style={{ marginBottom: 0 }}>
            This participant’s data was deleted
            {session.withdrawn_at
              ? ` on ${formatTime(session.withdrawn_at)}`
              : ""}
            . The code is kept so it is never reused.
          </p>
        </Callout>
      )}

      <Section title="Start-to-finish log">
        {log.timeline?.length ? (
          <ol className="timeline">
            {log.timeline.map((event, index) => (
              <li
                key={`${event.at}-${event.type}-${index}`}
                className="timeline__item"
              >
                <div className="timeline__when">{formatTime(event.at)}</div>
                <div className="timeline__what">{event.summary}</div>
                {event.detail && typeof event.detail === "object" && (
                  <div className="timeline__detail faint">
                    {Object.entries(event.detail)
                      .filter(([, v]) => {
                        if (v == null || v === "") return false;
                        if (Array.isArray(v)) return v.length > 0;
                        return typeof v !== "object";
                      })
                      .map(
                        ([k, v]) =>
                          `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : v}`,
                      )
                      .join(" · ")}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>Nothing recorded yet.</Empty>
        )}
      </Section>

      <Section title="Session">
        <Kv data={session} skip={["ip_hash"]} />
      </Section>

      <Section title="Age gate">
        {log.ageGate?.length ? (
          log.ageGate.map((row) => <Kv key={row.id} data={row} />)
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Consent">
        {log.consent?.length ? (
          log.consent.map((record) => (
            <div key={record.id} className="stack-sm">
              <Kv data={record} skip={["ip_hash", "user_agent", "items"]} />
              {record.items?.length > 0 && (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Required</th>
                        <th>Answer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.items.map((item) => (
                        <tr key={item.id}>
                          <td className="table-wrap">{item.item_text}</td>
                          <td>{item.required ? "yes" : "no"}</td>
                          <td>{item.response ? "agreed" : "not agreed"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Guardian">
        {log.guardian?.length ? (
          log.guardian.map((row) => <Kv key={row.id} data={row} />)
        ) : (
          <Empty>Not used.</Empty>
        )}
      </Section>

      <Section title="Demographics">
        {log.demographics ? (
          <>
            <Kv data={log.demographics} skip={["raw_payload"]} />
            <JsonBlock
              value={log.demographics.raw_payload}
              label="Verbatim submission"
            />
          </>
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Day reconstruction">
        {log.game?.length ? (
          log.game.map((game) => (
            <div key={game.id} className="stack">
              <Kv
                data={game}
                skip={["episodes", "saboteur", "pairwise", "config_json"]}
              />
              {game.episodes?.length ? (
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Band</th>
                        <th>Time</th>
                        <th>Domain</th>
                        <th>Moment</th>
                        <th>Tags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {game.episodes.map((episode) => (
                        <tr key={episode.id}>
                          <td>{episode.ordinal}</td>
                          <td>{episode.time_band || "—"}</td>
                          <td>
                            {episode.start_time || "—"}–
                            {episode.end_time || "—"}
                          </td>
                          <td>{episode.domain || "—"}</td>
                          <td className="table-wrap">
                            {episode.label || "—"}
                            {episode.description
                              ? ` — ${episode.description}`
                              : ""}
                          </td>
                          <td className="table-wrap">
                            {episode.tags?.map((t) => t.token_key).join(", ") ||
                              "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No moments recorded.</Empty>
              )}
            </div>
          ))
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="The Saboteur">
        {log.game?.some((g) => g.saboteur?.length) ? (
          log.game.flatMap((game) =>
            game.saboteur.map((round) => (
              <div key={round.id} className="stack-sm">
                <p style={{ marginBottom: 0 }}>
                  {round.skipped ? "Skipped. " : ""}
                  {round.prompt_text || "Make this moment worse."}
                </p>
                {round.responses?.length ? (
                  <ul>
                    {round.responses.map((response) => (
                      <li key={response.id}>
                        {response.response_text}
                        {response.response_ms != null
                          ? ` (${response.response_ms} ms)`
                          : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No answers.</Empty>
                )}
              </div>
            )),
          )
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Forced choice">
        {log.game?.some((g) => g.pairwise?.length) ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Left</th>
                  <th>Right</th>
                  <th>Chose</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {log.game.flatMap((game) =>
                  game.pairwise.map((round) => (
                    <tr key={round.id}>
                      <td>{round.ordinal}</td>
                      <td className="table-wrap">{round.left_text || "—"}</td>
                      <td className="table-wrap">{round.right_text || "—"}</td>
                      <td>{round.chosen_side || "—"}</td>
                      <td>
                        {round.response_ms != null
                          ? `${round.response_ms} ms`
                          : "—"}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Extraction">
        {log.extraction?.length ? (
          log.extraction.map((run) => (
            <div key={run.id} className="stack-sm">
              <Kv data={run} skip={["request_json", "response_json"]} />
              <JsonBlock
                value={run.request_json}
                label="Request sent to the model"
              />
              <JsonBlock value={run.response_json} label="Model response" />
            </div>
          ))
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Issues and ratings">
        {log.issues?.length ? (
          log.issues.map((issue) => (
            <div
              key={issue.id}
              className="stack-sm"
              style={{
                borderTop: "1px solid var(--line)",
                paddingTop: "var(--gap-sm)",
              }}
            >
              <p style={{ marginBottom: 0 }}>
                {issue.is_foil ? (
                  <span className="tag tag--warn">foil</span>
                ) : null}{" "}
                <strong>{issue.headline}</strong>
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Cause ({issue.cause_provenance}): {issue.cause}
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Affect ({issue.affect_provenance}): {issue.affect}
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Effect ({issue.effect_provenance}): {issue.effect}
              </p>
              {issue.rating ? (
                <p style={{ marginBottom: 0 }}>
                  Rating:{" "}
                  {issue.rating.rejected
                    ? "rejected"
                    : `severity ${issue.rating.severity ?? "—"}`}
                  {issue.rating.edit_note
                    ? ` · edit: ${issue.rating.edit_note}`
                    : ""}
                  {issue.rating.response_ms != null
                    ? ` · ${issue.rating.response_ms} ms`
                    : ""}
                </p>
              ) : (
                <Empty>Not rated.</Empty>
              )}
            </div>
          ))
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Post-questionnaire">
        {log.questionnaire?.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Answer</th>
                </tr>
              </thead>
              <tbody>
                {log.questionnaire.map((row) => (
                  <tr key={row.id}>
                    <td className="table-wrap">
                      {row.question_text || row.question_key}
                    </td>
                    <td className="table-wrap">
                      {row.response_text || row.response_value || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Debrief">
        {log.debrief?.length ? (
          log.debrief.map((row) => <Kv key={row.id} data={row} />)
        ) : (
          <Empty>Not reached.</Empty>
        )}
      </Section>

      <Section title="Telemetry">
        {log.telemetry?.length ? (
          <ol className="timeline">
            {log.telemetry.map((row) => (
              <li key={row.id} className="timeline__item">
                <div className="timeline__when">
                  {formatTime(row.client_ts || row.server_ts)}
                </div>
                <div className="timeline__what">
                  {row.event_type}
                  {row.page ? ` · ${row.page}` : ""}
                </div>
                {row.payload && (
                  <JsonBlock value={row.payload} label="Payload" />
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No telemetry events.</Empty>
        )}
      </Section>
    </div>
  );
}

export function DeleteControls({
  prompt,
  code,
  busy,
  onStart,
  onAgain,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState("");

  if (!prompt) {
    return (
      <Button variant="danger" onClick={onStart} disabled={busy}>
        Delete
      </Button>
    );
  }

  if (prompt.step === 1) {
    return (
      <>
        <span className="muted">Delete {code} and all of their data?</span>
        <Button variant="danger" onClick={onAgain} disabled={busy}>
          Yes, continue
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </>
    );
  }

  return (
    <div className="stack-sm" style={{ maxWidth: "22rem" }}>
      <p className="muted" style={{ marginBottom: 0 }}>
        This cannot be undone. Type <strong>{code}</strong> to permanently
        delete.
      </p>
      <input
        className="input"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        aria-label={`Type ${code} to confirm deletion`}
      />
      <div className="btn-row">
        <Button
          variant="danger"
          onClick={onConfirm}
          disabled={
            busy || typed.trim().toUpperCase() !== String(code).toUpperCase()
          }
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
