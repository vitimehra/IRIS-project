import { useId } from 'react';

/**
 * Form primitives.
 *
 * Every field can be left blank. A participant who abandons at a mandatory
 * income question yields no data at all, which is worse than a gap in one column.
 */

export function Field({ label, help, error, optional, htmlFor, labelHidden, children }) {
  return (
    <div className="field">
      <label className={labelHidden ? 'sr-only' : 'field__label'} htmlFor={htmlFor}>
        {label}
        {optional && !labelHidden && <span className="field__optional">optional</span>}
      </label>
      {help && <p className="field__help">{help}</p>}
      {children}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ label, help, error, optional, value, onChange, ...rest }) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} optional={optional} htmlFor={id}>
      <input
        id={id}
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
    </Field>
  );
}

export function NumberInput({ label, help, error, optional, value, onChange, ...rest }) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} optional={optional} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        className="input"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
    </Field>
  );
}

export function TextArea({ label, help, error, optional, labelHidden, value, onChange, ...rest }) {
  const id = useId();
  return (
    <Field
      label={label}
      help={help}
      error={error}
      optional={optional}
      labelHidden={labelHidden}
      htmlFor={id}
    >
      <textarea
        id={id}
        className="textarea"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      />
    </Field>
  );
}

export function Select({ label, help, error, optional, value, onChange, options, ...rest }) {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} optional={optional} htmlFor={id}>
      <select
        id={id}
        className="select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      >
        <option value="">Choose one…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function BooleanChoice({ label, help, error, optional, value, onChange }) {
  const name = useId();
  return (
    <Field label={label} help={help} error={error} optional={optional}>
      <div className="btn-row">
        {[
          { v: true, l: 'Yes' },
          { v: false, l: 'No' },
        ].map(({ v, l }) => (
          <label key={l} className={`choice ${value === v ? 'choice--checked' : ''}`} style={{ flex: '0 0 auto' }}>
            <input
              type="radio"
              name={name}
              checked={value === v}
              onChange={() => onChange(v)}
            />
            <span className="choice__text">{l}</span>
          </label>
        ))}
      </div>
    </Field>
  );
}

export function MultiSelect({ label, help, error, optional, value, onChange, options }) {
  const selected = Array.isArray(value) ? value : [];

  const toggle = (v) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };

  return (
    <Field label={label} help={help} error={error} optional={optional}>
      <fieldset className="choice-list">
        <legend className="sr-only">{label}</legend>
        {options.map((opt) => (
          <label
            key={opt.value}
            className={`choice ${selected.includes(opt.value) ? 'choice--checked' : ''}`}
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.value)}
              onChange={() => toggle(opt.value)}
            />
            <span className="choice__text">{opt.label}</span>
          </label>
        ))}
      </fieldset>
    </Field>
  );
}

export function Callout({ tone = 'info', children }) {
  const cls = tone === 'warn' ? 'callout callout--warn' : tone === 'note' ? 'callout callout--note' : 'callout';
  return <div className={cls}>{children}</div>;
}

export function Button({ variant = 'primary', children, ...rest }) {
  return (
    <button type="button" className={`btn btn--${variant}`} {...rest}>
      {children}
    </button>
  );
}
