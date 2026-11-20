/**
 * The day strip: 24 hours, dawn to night.
 *
 * This is the signature object of the instrument. It is the hero on the landing
 * page, the progress rail through consent and demographics, and in Phase 2 it
 * becomes the board the participant rebuilds their day onto. Using the actual
 * unit of analysis as the wayfinding device means identity and navigation are
 * the same thing rather than one bolted onto the other.
 */

export const TIME_BANDS = [
  { key: 'dawn', label: 'Dawn', hours: '5 – 7', color: 'var(--hour-dawn)' },
  { key: 'morning', label: 'Morning', hours: '7 – 11', color: 'var(--hour-morning)' },
  { key: 'midday', label: 'Midday', hours: '11 – 3', color: 'var(--hour-midday)' },
  { key: 'afternoon', label: 'Afternoon', hours: '3 – 6', color: 'var(--hour-afternoon)' },
  { key: 'evening', label: 'Evening', hours: '6 – 10', color: 'var(--hour-evening)' },
  { key: 'night', label: 'Night', hours: '10 – 5', color: 'var(--hour-night)' },
];

/** Compact form: the band used as a progress track. */
export function DayStripTrack({ progress = 0, className = '' }) {
  const clamped = Math.max(0, Math.min(1, progress));
  const litSegments = clamped * TIME_BANDS.length;

  return (
    <div className={`day-strip__track ${className}`} aria-hidden="true">
      {TIME_BANDS.map((band, index) => {
        // Segments light up as the participant moves through the study, so the
        // day visibly fills in rather than a bar merely growing.
        const fill = Math.max(0, Math.min(1, litSegments - index));
        return (
          <div
            key={band.key}
            className="day-strip__seg"
            style={{
              background: band.color,
              opacity: 0.22 + fill * 0.78,
            }}
          />
        );
      })}
    </div>
  );
}

/** Full form: the hero, with hour labels. */
export default function DayStrip({ height = 120, showLabels = true }) {
  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="day-strip"
        viewBox="0 0 600 120"
        preserveAspectRatio="none"
        style={{ height, width: '100%' }}
        role="img"
        aria-label="A band of colour running from dawn through morning, midday, afternoon and evening into night."
      >
        <defs>
          <linearGradient id="unfold-day" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--hour-dawn)" />
            <stop offset="18%" stopColor="var(--hour-morning)" />
            <stop offset="38%" stopColor="var(--hour-midday)" />
            <stop offset="58%" stopColor="var(--hour-afternoon)" />
            <stop offset="80%" stopColor="var(--hour-evening)" />
            <stop offset="100%" stopColor="var(--hour-night)" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="600" height="120" rx="10" fill="url(#unfold-day)" />

        {/* Hour ticks. Faint: they mark the day without turning it into a chart. */}
        {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
          <line
            key={hour}
            x1={(hour / 24) * 600}
            y1="0"
            x2={(hour / 24) * 600}
            y2={hour % 6 === 0 ? 120 : 14}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1"
          />
        ))}
      </svg>

      {showLabels && (
        <figcaption className="progress-rail__labels" style={{ marginTop: 'var(--gap-xs)' }}>
          {TIME_BANDS.map((band) => (
            <span key={band.key} className="progress-rail__label">
              {band.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
