// src/utils/formatText.jsx
import React from "react";

// Central registry for inline icon shortcodes like :sword:
const ICONS = {
  spirit: { svg: "/card-assets/icons/spirit.svg", png: "/card-assets/icons/spirit.png" },

  // sample set — add your own freely:
  sword: { svg: "/card-assets/icons/spirit_dot-danger.svg", png: "/card-assets/icons/spirit_dot-danger.png" },
  fire: { svg: "/card-assets/icons/fire.svg", png: "/card-assets/icons/fire.png" },
  skull: { svg: "/card-assets/icons/skull.svg", png: "/card-assets/icons/skull.png" },
  shield: { svg: "/card-assets/icons/shield.svg", png: "/card-assets/icons/shield.png" },
  bolt: { svg: "/card-assets/icons/bolt.svg", png: "/card-assets/icons/bolt.png" },
  heart: { svg: "/card-assets/icons/heart.svg", png: "/card-assets/icons/heart.png" },

  spirit_trgico: { svg: "/card-assets/icons/spirit_trgico.svg", png: "/card-assets/icons/spirit_trgico.png" },
  spirit_hitico: { svg: "/card-assets/icons/spirit_hitico.svg", png: "/card-assets/icons/spirit_hitico.png" },
  spirit_ghitico: { svg: "/card-assets/icons/spirit_ghitico.svg", png: "/card-assets/icons/spirit_ghitico.png" },
  spirit_misico: { svg: "/card-assets/icons/spirit_misico.svg", png: "/card-assets/icons/spirit_misico.png" },
  spirit_compico: { svg: "/card-assets/icons/spirit_compico.svg", png: "/card-assets/icons/spirit_compico.png" },
  spirit_resico: { svg: "/card-assets/icons/spirit_resico.svg", png: "/card-assets/icons/spirit_resico.png" },
  spirit_fixico: { svg: "/card-assets/icons/spirit_fixico.svg", png: "/card-assets/icons/spirit_fixico.png" },
  spirit_heavico: { svg: "/card-assets/icons/spirit_heavico.svg", png: "/card-assets/icons/spirit_heavico.png" },
  spirit_medico: { svg: "/card-assets/icons/spirit_medico.svg", png: "/card-assets/icons/spirit_medico.png" },
  spirit_lighico: { svg: "/card-assets/icons/spirit_lighico.svg", png: "/card-assets/icons/spirit_lighico.png" },
  spirit_zeroico: { svg: "/card-assets/icons/spirit_zeroico.svg", png: "/card-assets/icons/spirit_zeroico.png" },
  spirit_weapico: { svg: "/card-assets/icons/spirit_weapico.svg", png: "/card-assets/icons/spirit_weapico.png" },
  spirit_envico: { svg: "/card-assets/icons/spirit_envico.svg", png: "/card-assets/icons/spirit_envico.png" },
  spirit_socico: { svg: "/card-assets/icons/spirit_socico.svg", png: "/card-assets/icons/spirit_socico.png" },
  spirit_expico: { svg: "/card-assets/icons/spirit_expico.svg", png: "/card-assets/icons/spirit_expico.png" },
  spirit_puzico: { svg: "/card-assets/icons/spirit_puzico.svg", png: "/card-assets/icons/spirit_puzico.png" },
  spirit_hazico: { svg: "/card-assets/icons/spirit_hazico.svg", png: "/card-assets/icons/spirit_hazico.png" },
  spirit_trapico: { svg: "/card-assets/icons/spirit_trapico.svg", png: "/card-assets/icons/spirit_trapico.png" },
};

function renderIcon(name, key, opts = {}) {
  const ico = ICONS[(name || "").toLowerCase()];
  if (!ico) return `:${name}:`; // NOTE: may be a string fallback

  const {
    title = name,
    className = "",
    scale = 1.2,
    padTop = null,
    padBottom = null,
    shiftY = null,
    mx = "0.08em",
  } = opts;

  const transforms = [];
  if (scale !== 1) transforms.push(`scale(${scale})`);
  if (shiftY) transforms.push(`translateY(${shiftY})`);

  return (
    <span
      key={key}
      className={`emoji-wrap ${className}`}
      style={{
        display: "inline-block",
        lineHeight: 0,
        verticalAlign: "-0.15em",
        margin: `0 ${mx}`,
        paddingTop: padTop || undefined,
        paddingBottom: padBottom || undefined,
        transform: transforms.length ? transforms.join(" ") : undefined,
        transformOrigin: "center",
      }}
    >
      <img className="inline-ico emoji export-swap" src={ico.svg} data-png={ico.png} alt={title} />
    </span>
  );
}

let DEBUG = false;
export function enableFormatDebug(on = true) {
  DEBUG = !!on;
}

export default function formatText(raw, keywords = []) {
  const input = (raw ?? "").toString();
  let nodes = [input];

  let K = 0;
  const k = (p = "k") => `${p}-${K++}`;

  const apply = (re, render, label) => {
    let matches = 0;
    const out = [];

    nodes.forEach((node) => {
      if (typeof node !== "string") {
        out.push(node);
        return;
      }
      let last = 0,
        m;
      re.lastIndex = 0;
      while ((m = re.exec(node)) !== null) {
        matches++;
        const i = m.index;
        if (i > last) out.push(node.slice(last, i));
        out.push(render(m, k(label || "hit")));
        last = i + m[0].length;
      }
      if (last < node.length) out.push(node.slice(last));
    });

    if (DEBUG) console.log("[formatText]", label || "(pass)", { matches, sample: nodes.slice(0, 3) });
    nodes = out;
  };

  const isEl = (x) => React.isValidElement(x);

  /* ---------- ALIGNMENT TAGS (RUN FIRST) ---------- */
  apply(/\[(l|left|c|center|r|right)\]([\s\S]+?)\[\/\1\]/gi, (m, key) => {
  const dirToken = m[1].toLowerCase();
  const dir =
    (dirToken === 'r' || dirToken === 'right') ? 'right' :
    (dirToken === 'l' || dirToken === 'left')  ? 'left'  :
    'center';

  const children = formatText(m[2], keywords);
  return (
    <span
      key={key}
      className={`align align-${dir}`}
      style={{ display: 'inline-block', width: '100%', textAlign: dir }}
    >
      {children}
    </span>
  );
}, 'align-blocks');


  /* ---------- UNDERLINE TAGS (RUN RIGHT AFTER ALIGNMENT) ---------- */
  apply(/\[(u|underline)\]([\s\S]+?)\[\/\1\]/gi, (m, key) => (
    <span key={key} style={{ textDecoration: "underline" }}>
      {formatText(m[2], keywords)}
    </span>
  ), "bb-underline");

/* ---------- MARKDOWN DIVIDER: a line with --- becomes a rule ---------- */
/* Consume surrounding newline(s) and rely on .rule margins only. */
apply(
  /(^|\r?\n)[ \t]*-{3,}[ \t]*(\r?\n|$)/g,
  (_m, key) => (
    <span key={key} className="rule" role="separator" aria-hidden="true" />
  ),
  "md-hr"
);



  /* ---------- EMOJI-STYLE SHORTCODES (RUN SECOND) ---------- */
  apply(
    /(^|[^\\]):([a-z][a-z0-9_-]{1,32})(?:\{([^}]+)\})?:/gi,
    (m, key) => {
      const pre = m[1] || "";
      const name = m[2];
      const rawOpts = (m[3] || "").trim();

      let scale = 1;
      let wantIndent = false;
      let indentCSS = null;
      let padTop = null,
        padBottom = null;
      let shiftY = null;

      let ml = null,
        mr = null,
        mx = null;

      if (rawOpts) {
        const named = { sm: 0.85, md: 1, lg: 1.25, xl: 1.5, xxl: 2 };
        const toks = rawOpts.split(",").map((s) => s.trim()).filter(Boolean);

        for (const tok of toks) {
          if (/^\d+(\.\d+)?x$/i.test(tok)) {
            scale = parseFloat(tok);
            continue;
          }
          if (/^\d+(\.\d+)?%$/.test(tok)) {
            scale = parseFloat(tok) / 100;
            continue;
          }
          if (named[tok.toLowerCase()]) {
            scale = named[tok.toLowerCase()];
            continue;
          }

          if (/^indent$/i.test(tok)) {
            wantIndent = true;
            continue;
          }
          const mIndent = /^indent\s*=\s*(.+)$/i.exec(tok);
          if (mIndent) {
            wantIndent = true;
            indentCSS = mIndent[1];
            continue;
          }

          const mPt = /^pt\s*=\s*(.+)$/i.exec(tok);
          if (mPt) {
            padTop = mPt[1];
            continue;
          }
          const mPb = /^pb\s*=\s*(.+)$/i.exec(tok);
          if (mPb) {
            padBottom = mPb[1];
            continue;
          }
          const mPy = /^py\s*=\s*(.+)$/i.exec(tok);
          if (mPy) {
            padTop = padBottom = mPy[1];
            continue;
          }
          const mShift = /^shift\s*=\s*(.+)$/i.exec(tok);
          if (mShift) {
            shiftY = mShift[1];
            continue;
          }

          const mMx = /^mx\s*=\s*(.+)$/i.exec(tok);
          if (mMx) {
            mx = mMx[1];
            continue;
          }
          const mMl = /^ml\s*=\s*(.+)$/i.exec(tok);
          if (mMl) {
            ml = mMl[1];
            continue;
          }
          const mMr = /^mr\s*=\s*(.+)$/i.exec(tok);
          if (mMr) {
            mr = mMr[1];
            continue;
          }

          if (/^hug$/i.test(tok)) {
            ml = mr = "-0.1em";
            continue;
          }
          if (/^hugL$/i.test(tok)) {
            ml = "-0.1em";
            continue;
          }
          if (/^hugR$/i.test(tok)) {
            mr = "-0.1em";
            continue;
          }
        }
      }

      if (wantIndent && !indentCSS) indentCSS = `${scale}em`;

      const hasLeadingBreak = /\r?\n/.test(pre);
      const isLineStart = hasLeadingBreak || pre === "";

      const iconEl = renderIcon(name, key, { scale, padTop, padBottom, shiftY });

      const finalML = ml ?? mx ?? null;
      const finalMR = mr ?? mx ?? null;

      // If we have a string fallback (unknown icon), never cloneElement it.
      if (!isEl(iconEl)) {
        return (
          <React.Fragment key={key}>
            {hasLeadingBreak ? <br /> : pre}
            {iconEl}
          </React.Fragment>
        );
      }

      if (wantIndent && isLineStart) {
        return (
          <React.Fragment key={key}>
            {hasLeadingBreak ? <br /> : pre}
            <span className="emoji-lead" style={{ ["--indent"]: indentCSS }}>
              {React.cloneElement(iconEl, {
                className: `${iconEl.props.className} no-gap`,
                style: {
                  ...(iconEl.props.style || {}),
                  margin: 0,
                  ...(finalMR ? { marginRight: finalMR } : {}),
                },
              })}
            </span>
          </React.Fragment>
        );
      }

      const inline =
        finalML || finalMR ? (
          <span
            key={`${key}-wrap`}
            className="emoji-mx"
            style={{ display: "inline-flex", marginLeft: finalML || undefined, marginRight: finalMR || undefined }}
          >
            {React.cloneElement(iconEl, { style: { ...(iconEl.props.style || {}), margin: 0 } })}
          </span>
        ) : (
          iconEl
        );

      return (
        <React.Fragment key={key}>
          {hasLeadingBreak ? <br /> : pre}
          {inline}
        </React.Fragment>
      );
    },
    "emoji-shortcodes"
  );

  /* ---------- BULLETS (RUN BEFORE NUMBERS/MARKDOWN) ---------- */
  apply(
    /(^|\n)\s*-(?!-)\s+(?=\S)/g,
    (m, key) => (
      <React.Fragment key={key}>
        {m[1] ? <br /> : null}
        <span className="bullet-dot">•</span>&nbsp;
      </React.Fragment>
    ),
    "bullets"
  );

  /* ---------- ICONS & NUMBERS (RUN BEFORE MARKDOWN) ---------- */
  apply(/([+\-]\s*\d+)\s*[¤§◊◆◇]/g, (m, key) => (
    <span key={key} className="nowrap">
      <strong className="num" style={{ fontWeight: 800 }}>
        {m[1].replace(/\s+/g, "")}
      </strong>
      {renderIcon("spirit", `${key}-ico`, { mx: "-0.04em" })}
    </span>
  ), "spirit +/-N¤");

  apply(/[¤§◊◆◇]/g, (_m, key) => renderIcon("spirit", key, { mx: "-0.04em" }), "spirit ¤");

  apply(/(^|[^\w\d])([+\-]\s*\d+)(?!\s*[¤§◊◆◇]|\d)/g, (m, key) => (
    <React.Fragment key={key}>
      {m[1]}
      <strong className="num" style={{ fontWeight: 800 }}>
        {m[2].replace(/\s+/g, "")}
      </strong>
    </React.Fragment>
  ), "bare +/-N");

  apply(/(^|[^\w%])(\d+(?:[.,]\d+)?)(?![\w%])/g, (m, key) => (
    <React.Fragment key={key}>
      {m[1]}
      <strong className="num" style={{ fontWeight: 800 }}>
        {m[2]}
      </strong>
    </React.Fragment>
  ), "any number (safe)");

  /* ---------- SIMPLE MARKDOWN ---------- */
  apply(/\*([^*]+)\*/g, (m, key) => (
    <strong key={key} style={{ fontWeight: 800 }}>
      {m[1]}
    </strong>
  ), "md-bold");

  apply(/_([^_]+)_/g, (m, key) => <em key={key}>{m[1]}</em>, "md-italic");

  /* ---------- KEYWORDS ---------- */
  apply(/\b(Good\s*Hit|Hit|Miss|Complication|Target|Resolve|RP)\b(\s*[:;,.!?])?/g, (m, key) => (
    <strong key={key} className="nowrap" style={{ fontWeight: 800 }}>
      {m[1].replace(/\s+/, "\u00A0")}
      {m[2] || ""}
    </strong>
  ), "outcomes");

  apply(/\b(Finesse|Fortitude|Intellect|Persona)\b/g, (m, key) => (
    <strong key={key} className="nowrap" style={{ fontWeight: 800 }}>
      {m[1]}
    </strong>
  ), "attributes");

  apply(/\b(Action|Use|Test|Prepare|Stow)\b/g, (m, key) => (
    <strong key={key} className="nowrap" style={{ fontWeight: 800 }}>
      {m[1]}
    </strong>
  ), "actions");

  apply(/\b(Dodge|Resist|Dash|Utilize|Discover|Opportunity)\b/g, (m, key) => (
    <strong key={key} className="nowrap" style={{ fontWeight: 800 }}>
      {m[1]}
    </strong>
  ), "opportunities");

  apply(/\b(Blunt|Pierce|Slash|Mental|Burn|Freeze|Shock|Poison|Force|Radiant|Umbral|Wound|Heavy\s*Wound)\b/g, (m, key) => (
    <strong key={key} className="nowrap" style={{ fontWeight: 800 }}>
      {m[0]}
    </strong>
  ), "damage types");

  apply(
    /\b(Striking\s*Range|Spitting\s*Range|Throwing\s*Range|Shooting\s*Range|Yonder|Pushing\s*the\s*Range|Movement|Move|Dash)\b(\s*[:;,.!?])?/g,
    (m, key) => {
      const term = m[1].replace(/\s+Range$/i, "\u00A0Range");
      const tail = m[2] || "";
      return (
        <em key={key} className="nowrap" data-k="range" style={{ fontWeight: 700 }}>
          {term}
          {tail}
        </em>
      );
    },
    "range/movement (italic)"
  );

  const safeTitles = (Array.isArray(keywords) ? keywords : []).map((t) => (t || "").trim()).filter(Boolean);
  if (safeTitles.length) {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const alt = safeTitles.map(esc).join("|");
    const re = new RegExp(`\\b(${alt})\\b`, "g");

    apply(re, (m, key) => (
      <strong key={key} className="kwd nowrap" style={{ fontWeight: 800, textDecoration: "none" }} data-k="title">
        {m[0]}
      </strong>
    ), "title keywords");
  }







  /* Unescape '\:' -> ':' */
  {
    const out = [];
    for (const n of nodes) {
      if (typeof n === "string") out.push(n.replace(/\\:/g, ":"));
      else out.push(n);
    }
    nodes = out;
  }

  /* ---------- FINAL PASS: "\n" -> <br/> ---------- */
  {
    const out = [];
    for (const node of nodes) {
      if (typeof node !== "string") {
        out.push(node);
        continue;
      }
      const parts = node.split(/\r?\n/);
      parts.forEach((part, i) => {
        if (i) out.push(<br key={k("lb")} />);
        if (part) out.push(part);
      });
    }
    nodes = out;
  }

  if (DEBUG) window.__fmt_debug = (window.__fmt_debug || 0) + 1;
  return nodes;
}
