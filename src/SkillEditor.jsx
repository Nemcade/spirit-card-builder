// SkillEditor.jsx
import { useMemo } from 'react';

export default function SkillEditor({
  s,                // { id, kind?, title, proficiency, tierDots, sections[] }
  onChange,         // (key, value) -> void
  onDelete,         // () -> void
  profs = []        // array of strings for datalist suggestions
}) {
  const kind = s.kind || 'skill';
  const isSection = kind === 'section';
  const setKind = (e) => onChange('kind', e.target.value);

  const dlId = useMemo(() => `profDL-${s.id}`, [s.id]);

  const set     = (k) => (e) => onChange(k, e.target.value);
  const setNum  = (k) => (e) => onChange(k, Math.max(0, Number(e.target.value) || 0));

// --- paragraph helpers (backwards-compatible: string => {text, cols:1}) ---
// Normalize: accept both "string" and {text, cols}
const normSections = (arr = []) =>
  arr.map(sec =>
    typeof sec === 'string' ? { text: sec, cols: 1 } : { cols: 1, text: '', ...sec }
  );

// ----- paragraph helpers (use onChange, not update) -----
const addSection = () => {
  const next = [...normSections(s.sections), { text: '', cols: 1 }];
  onChange('sections', next);
};

const setSectionText = (i, text) => {
  const arr = normSections(s.sections);
  arr[i] = { ...arr[i], text };
  onChange('sections', arr);
};

const setSectionCols = (i, cols) => {
  const arr = normSections(s.sections);
  arr[i] = { ...arr[i], cols: Number(cols) || 1 };
  onChange('sections', arr);
};

const removeSection = (i) => {
  const arr = normSections(s.sections).filter((_, idx) => idx !== i);
  onChange('sections', arr);
};



  return (
    <div
      style={{
        border: '1px solid #ccc',
        borderRadius: 8,
        padding: 10,
        marginBottom: 8,
        display: 'grid',
        gap: 6
      }}
    >
      {/* Header row */}
      <div style={{ display:'grid', gridTemplateColumns:'190px 1fr auto', gap:8, alignItems:'center' }}>

        <input
          placeholder="Title"
          value={s.title || ''}
          onChange={set('title')}
          style={{ flex: 1 }}
        />
          <select value={s.kind} onChange={set('kind')} style={{ width: 80 }}>
    <option value="skill">Skill</option>
    <option value="section">Section</option>
  </select>
        <button
          onClick={onDelete}
          style={{
            background: '#e44',
            color: '#fff',
            border: 'none',
            padding: '6px 8px',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          Delete
        </button>
      </div>

      {/* Proficiency + dots */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 8 }}>
        <div>
          <input
            placeholder={
              isSection ? 'Sub-Header (e.g. Triggers)' : 'Proficiency (e.g. Hack & Slash)'
            }
            value={s.proficiency || ''}
            onChange={set('proficiency')}
            list={dlId}
          />
          <datalist id={dlId}>
            {profs.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        {!isSection ? (
          <input
            type="number"
            min={0}
            max={10}
            step={1}
            value={Number.isFinite(+s.tierDots) ? +s.tierDots : 0}
            onChange={setNum('tierDots')}
            title="Tier dots / level"
          />
        ) : (
          <div
            style={{
              opacity: 0.5,
              textAlign: 'center',
              border: '1px dashed #ccc',
              borderRadius: 6,
              padding: '6px 0'
            }}
          >
            no dots
          </div>
        )}
      </div>

{/* Paragraphs */}
<div style={{ display: 'grid', gap: 6 }}>
  {normSections(s.sections).map((sec, i) => (
    <div key={i} style={{ display: 'grid', gap: 6 }}>
      <textarea
        placeholder={`Paragraph ${i + 1}`}
        value={sec.text}
        onChange={(e) => setSectionText(i, e.target.value)}
      />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ opacity: 0.75 }}>Layout:</span>
          <select
            value={sec.cols}
            onChange={(e) => setSectionCols(i, e.target.value)}
          >
            <option value={1}>1 column</option>
            <option value={2}>2 columns</option>
          </select>
        </label>

        <button
          onClick={() => removeSection(i)}
          style={{
            background: '#eee',
            border: '1px solid #ccc',
            padding: '4px 8px',
            borderRadius: 6,
            cursor: 'pointer'
          }}
        >
          Remove paragraph
        </button>
      </div>
    </div>
  ))}

  <button
    onClick={addSection}
    style={{
      background: '#f7f7f7',
      border: '1px solid #ccc',
      padding: '6px 8px',
      borderRadius: 6,
      cursor: 'pointer'
    }}
  >
    + Paragraph
  </button>
</div>


    </div>
  );
}
