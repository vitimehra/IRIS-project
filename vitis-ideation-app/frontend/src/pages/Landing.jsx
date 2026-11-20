import { Link } from 'react-router-dom';
import Layout from '../components/Layout.jsx';

export default function Landing() {
  return (
    <Layout right={<Link className="btn btn--ghost btn--sm" to="/console">Experimenter</Link>}>
      <section className="hero">
        <p className="eyebrow">A research study</p>
        <h1>From a small everyday annoyance to a product you can see.</h1>
        <p className="lede">
          You describe something that gets in your way. The system structures it, turns it into a design problem, and then
          you and it generate ideas three different ways — including one that draws inspiration from a web of
          twenty-three thousand verbs and the phenomena of the world they describe.
        </p>
        <div className="row">
          <Link className="btn" to="/login">I have a participant code</Link>
        </div>
      </section>

      <section className="grid3">
        <div className="card">
          <h3>1 · Describe</h3>
          <p>Talk or type about a difficulty in your day. It is structured as cause, affect and effect, and you correct it.</p>
        </div>
        <div className="card">
          <h3>2 · Ideate</h3>
          <p>First your own ideas. Then the AI's. Then ideas inspired by phenomena reached through the Inspider web.</p>
        </div>
        <div className="card">
          <h3>3 · Judge</h3>
          <p>Every idea becomes a concept and a rendered product. You rate them all, without knowing which method made which.</p>
        </div>
      </section>

      <section className="vine" aria-hidden="true">
        <svg viewBox="0 0 800 120" preserveAspectRatio="none">
          <path d="M0 100 C 120 20, 200 20, 300 80 S 480 140, 560 60 S 720 0, 800 90" fill="none" stroke="var(--vine)" strokeWidth="1.5" opacity="0.6" />
          {[90, 220, 330, 470, 560, 690].map((x, i) => <circle key={i} cx={x} cy={[70, 32, 74, 96, 60, 24][i]} r="4" fill="var(--vine)" />)}
        </svg>
      </section>
    </Layout>
  );
}
