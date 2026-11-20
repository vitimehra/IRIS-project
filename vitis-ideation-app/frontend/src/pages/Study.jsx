import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout, { Notice, Spinner, Stepper } from "../components/Layout.jsx";
import { api, tokens } from "../api/client.js";
import {
  AopcStage,
  AutoWait,
  CaeStage,
  DoneStage,
  IssueStage,
  KeywordsStep,
  NeighboursStep,
  PhenomenaStep,
  ProblemsStage,
  RatingStage,
  ReviewPage,
  SelectStep,
  TraditionalStage,
} from "./study/stages.jsx";

/**
 * The study is server-driven: every action returns the new state and this
 * page simply renders whatever stage the server says the participant is at.
 * A refresh, a crash, a second device - all land on the right screen.
 */
export default function Study() {
  const nav = useNavigate();
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null); // page key of the read-only look-back, or null
  const seq = useRef(0);

  const reload = useCallback(async () => {
    try {
      setSt(await api.state());
    } catch (e) {
      if (e.status === 401) nav("/login");
      else if (e.status === 403) nav("/consent");
      else setError(e.message);
    }
  }, [nav]);

  useEffect(() => {
    if (!tokens.get("participant")) nav("/login");
    else reload();
  }, [nav, reload]);

  useEffect(() => {
    setReview(null);
  }, [st?.stage, st?.substage]);

  const act = useCallback(
    async (fn, { silent = false } = {}) => {
      const mine = ++seq.current;
      setBusy(true);
      setError(null);
      try {
        const next = await fn();
        if (mine !== seq.current) return;
        if (next) setSt(next);
        else if (!silent) await reload();
      } catch (e) {
        if (mine !== seq.current) return;
        if (e.status === 401) nav("/login");
        else if (e.status === 409) {
          try {
            const latest = await api.state();
            if (mine !== seq.current) return;
            setSt(latest);
            setError(null);
          } catch {
            setError(e.message);
          }
        } else setError(e.message);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [nav, reload],
  );

  if (!st)
    return (
      <Layout>
        <Spinner label="Loading your session…" />
      </Layout>
    );

  const stage = st.stage;
  let body;
  if (review) body = <ReviewPage key={review} pageKey={review} onClose={(k) => setReview(k || null)} />;
  else if (stage === "issue") body = <IssueStage act={act} busy={busy} />;
  else if (stage === "cae")
    body = (
      <CaeStage
        key={st.issues.map((i) => i.id).join()}
        st={st}
        act={act}
        busy={busy}
      />
    );
  else if (stage === "problems")
    body = <ProblemsStage st={st} act={act} busy={busy} />;
  else if (stage === "aopc") body = <AopcStage st={st} act={act} busy={busy} />;
  else if (stage === "traditional")
    body = <TraditionalStage st={st} act={act} busy={busy} />;
  else if (stage === "auto_1" || stage === "auto_2") {
    if (st.condition === "inspider") {
      if (st.substage === "keywords")
        body = <KeywordsStep st={st} act={act} busy={busy} />;
      else if (st.substage === "neighbours")
        body = <NeighboursStep st={st} act={act} busy={busy} />;
      else if (st.substage === "select")
        body = <SelectStep st={st} act={act} busy={busy} />;
      else if (st.substage === "phenomena")
        body = <PhenomenaStep st={st} act={act} busy={busy} reload={reload} />;
      else body = <AutoWait label="Generating inspired ideas…" />;
    } else body = <AutoWait label="The AI is generating ideas…" />;
  } else if (stage.startsWith("rate_"))
    body = (
      <RatingStage key={stage} st={st} act={act} busy={busy} reload={reload} />
    );
  else if (stage === "done") body = <DoneStage st={st} />;

  return (
    <Layout
      right={
        <button
          className="btn btn--quiet btn--sm"
          onClick={() => {
            tokens.set("participant", null);
            nav("/");
          }}
        >
          Sign out
        </button>
      }
    >
      <Stepper stages={st.stages} current={stage} order={st.condition_order} onBack={(k) => setReview(k)} reviewing={!!review} />
      {!review && stage !== "issue" && (
        <div className="row row--between" style={{ marginTop: "-0.75rem", marginBottom: "0.75rem" }}>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => setReview("latest")}>← Look back at earlier steps</button>
        </div>
      )}
      {error && <Notice tone="warn">{error}</Notice>}
      <div className="stage">{body}</div>
    </Layout>
  );
}
