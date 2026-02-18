// App.jsx
import { useState, useEffect, useMemo } from 'react';
import { v4 as uuid }        from 'uuid';
import html2canvas           from 'html2canvas';
import jsPDF                 from 'jspdf';

import SkillEditor  from './SkillEditor.jsx';
import CardPreview  from './CardPreview.jsx';

const SCHEMA_VERSION = 2; // bump when you add new migrations later

/* ---------- helpers for JSON download / upload ---------- */
const saveJson = (data, fname) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click(); URL.revokeObjectURL(a.href);
};
const loadJson = file => new Promise((res,rej)=>{
  const r = new FileReader();
  r.onerror = rej;
  r.onload  = () => { try{ res(JSON.parse(r.result)); }catch(e){ rej(e); } };
  r.readAsText(file);
});

// Safe filename helper
const safeFileName = (s) =>
  (String(s || 'SpiritCard').trim() || 'SpiritCard')
    .replace(/[\\/:*?"<>|]+/g, '')   // strip illegal
    .replace(/\s+/g, '_')            // spaces -> underscores
    .slice(0, 80);


// App.jsx
const PRELOAD_WEIGHTS = [400, 600, 700, 800]; // pick what you actually use

const NUNITO_CSS =
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';

async function preloadNunito() {
  // Kick font loading in the main document so it’s in cache before we clone
  const loads = PRELOAD_WEIGHTS.map(w => 
    document.fonts.load(`${w} 16px "Nunito"`)
  );
  await Promise.allSettled(loads);
}

const CHALLENGE_CATEGORIES = [
  'Combat','Environmental','Social','Exploration','Puzzle','Hazard','Trap','Affliction'
];
const CHALLENGE_RARITIES = ['Core Challenge', 'Sub-Challenge'];

// --- Import helpers: ensure unique names/ids and normalize cards ---
const uniqueCopyName = (name, taken) => {
  // If the exact name doesn't exist, keep it
  if (!taken.has(name)) return name;

  // Strip trailing (copy) / (copy N) if present to find the base
  const base = name.replace(/\s\((?:copy(?:\s+\d+)?)\)$/i, '');
  let n = 1;
  // First duplicate -> "(copy)", further -> "(copy 2)", "(copy 3)", ...
  // We only rename the imported/newer one(s)
  while (true) {
    const candidate = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
    if (!taken.has(candidate)) return candidate;
    n++;
  }
};

const normalizeImportedCard = (raw, takenIds, takenNames) => {
  const c = JSON.parse(JSON.stringify(raw || {}));

  // Unique ID for the card
  let id = c.id;
  if (!id || takenIds.has(id)) id = uuid();
  c.id = id;
  takenIds.add(id);

  // Unique name by library NAME, not ID
  let name = typeof c.name === 'string' && c.name.trim() ? c.name.trim() : 'Untitled';
  name = uniqueCopyName(name, takenNames);
  c.name = name;
  takenNames.add(name);

  // Ensure skill IDs exist
  if (Array.isArray(c.skills)) {
    c.skills = c.skills.map(s => ({
      ...s,
      id: s?.id || uuid(),
    }));
  }
  
  // Backfill 'kind' on import too
if (!c.kind) {
  const looksLikeChallenge =
    CHALLENGE_RARITIES.includes(c.rarity) ||
    CHALLENGE_CATEGORIES.includes(c.size) ||
    /Core Challenge|Sub-?Challenge/i.test(String(c.type || '')) ||
    (String(c.valueType || '') && (normalizeVT(c.valueType) === 'Danger'));
  c.kind = looksLikeChallenge ? 'Challenge' : 'Item';
}


  return c;
};



// Ensure Nunito is present & loaded before we measure or export
const ensureNunito = async () => {
  // attach stylesheet to main document once
  if (!document.querySelector('link[data-nunito]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = NUNITO_CSS;
    l.setAttribute('data-nunito', '');
    document.head.appendChild(l);
  }
  if (!document.fonts) return;
  const faces = ['400 16px Nunito', '600 16px Nunito', '700 16px Nunito', '800 16px Nunito', '900 16px Nunito'];
  try {
    await Promise.all(faces.map(f => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {}
};

// ---- FONT PRELOAD HELPER (use local Nunito) ----
async function waitForNunito() {
  // If the browser doesn't support the Font Loading API, just continue
  if (!document.fonts || !document.fonts.load) return;

  // Ask the browser to load Nunito at a few weights/sizes we use for titles
  const weights = [400, 700, 800, 900];
  const sizes   = [16, 24, 32]; // multiple sizes makes bbox more reliable
  const loads = [];
  for (const w of weights) {
    for (const px of sizes) {
      loads.push(document.fonts.load(`${w} ${px}px "Nunito"`));
    }
  }

  try {
    await Promise.all(loads);
    await document.fonts.ready;         // all faces done
  } catch (_) {
    // ignore; we'll still proceed
  }

  // tiny settle helps some browsers finalize metrics
  await new Promise(r => setTimeout(r, 30));
}



/* CSS we inject only inside the html2canvas clone to avoid 0×0 gradients */
const EXPORT_SAFE_CSS = `
@font-face{
  font-family:'Nunito';
  src:url('/fonts/Nunito-VariableFont_wght.ttf') format('truetype');
  font-weight:100 900;
  font-style:normal;
  font-display:block; /* block = no fallback flash during capture */
}
  /* Replace gradient underlines while exporting */
  .kwd, .kwd-title { background-image: none !important; text-decoration: underline !important; }
  .kwd       { text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; }
  .kwd-title { text-decoration-thickness: 0.12em; text-underline-offset: 0.20em; }

  /* Flip/perspective should not interfere */
  .export-mode .card{ perspective:none !important; overflow:visible !important; }
  .export-mode .preview-scale{ transform:none !important; }
  .export-mode .front, .export-mode .back{
    transform:none !important; backface-visibility:visible !important;
  }
  /* Let back face show overhangs while capturing */
  .export-mode .card .back{ overflow:visible !important; }

  /* Keep overlays stable in canvas render */
  .type-badge .type-overlay,
  .skill-header .skill-overlay{ object-fit: cover !important; transform:none !important; }

  /* For the clone only: hide the type-badge overlay graphic to rule it out as a culprit */
  .export-mode .type-badge::before,
  .export-mode .type-badge .type-overlay{
    display:none !important;
    background:none !important;
    content:none !important;
  }
`;



/* ---------- default blank card ---------- */
const blankCard = () => ({
  id:        uuid(),
  kind: 'Item',            // NEW: Item | Challenge
  name:      '',
  type:      '',
  size:      '',         // ← empty by default
  rarity:    '',         // ← empty by default
  value:     '',         // ← empty string so the number field can be empty
  valueType: '',         // ← empty by default
  flavor:    '',
  skills:    [],
  art:       '',
  version:       '',
  printer:   false
});

/* small async helpers */
const raf = () => new Promise(r => requestAnimationFrame(r));
const waitImages = (root) => Promise.all(
  Array.from(root?.querySelectorAll('img') || []).map(img => new Promise(res=>{
    if (img.complete) return res();
    const done = () => { img.onload = img.onerror = null; res(); };
    img.onload = done; img.onerror = done;
  }))
);

const isBlank = v => String(v ?? '').trim() === '';
const Warn = ({show}) => show ? <span className="req" title="Required">⚠</span> : null;

const normalizeVT = v => (v === 'Assets' ? 'Asset' : v);

/* Swap routine for export: prefers PNG when capturing */
function swapSvgsForPngs(root) {
  const imgs = Array.from(root?.querySelectorAll('img') || []);
  const backup = imgs.map(img => ({ src: img.src, cross: img.crossOrigin }));

  imgs.forEach(img => {
    let png = null;

    const dataPng = img.getAttribute('data-png');
    if (img.classList.contains('export-swap') && dataPng) {
      png = dataPng;
    } else {
      try {
        const u = new URL(img.src, window.location.href);
        if (/^\/card-assets\/.*\.svg$/i.test(u.pathname)) {
          png = img.src.replace(/\.svg(\?.*)?$/i, '.png$1');
        }
      } catch {
        if (/\/card-assets\/.*\.svg(\?.*)?$/i.test(img.src)) {
          png = img.src.replace(/\.svg(\?.*)?$/i, '.png$1');
        }
      }
    }

    if (png) {
      img.crossOrigin = 'anonymous';
      img.src = png;
    }
  });

  return () => {
    imgs.forEach((img,i) => {
      img.src = backup[i].src;
      img.crossOrigin = backup[i].cross;
    });
  };
}

/* Utility: safe, case-insensitive includes */
const includesCI = (hay, needle) =>
  String(hay ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase().trim());

/* Utility: collect unique, sorted array of non-empty strings */
const uniqSorted = (arr) =>
  Array.from(new Set(arr.filter(Boolean).map(s => String(s).trim()))).sort((a,b)=>a.localeCompare(b));
  
 


/* --------------------------------------------------------------------------
   MAIN APP
   -------------------------------------------------------------------------- */
export default function App() {

  /* 1) library + current selection --------------------------------------- */
  const [library, setLibrary]   = useState(() => {
    try{ return JSON.parse(localStorage.getItem('spirit.cards')) || []; }
    catch{ return []; }
  });
  
  useEffect(() => {
  const seen = Number(localStorage.getItem('spirit.schema') || 0);
  if (seen >= SCHEMA_VERSION) return;

  let changed = false;
  const upgraded = (Array.isArray(library) ? library : []).map((c) => {
    const next = { ...c };

    // Backfill 'kind'
    if (!next.kind) {
      const looksLikeChallenge =
        CHALLENGE_RARITIES.includes(next.rarity) ||
        CHALLENGE_CATEGORIES.includes(next.size) ||
        /Core Challenge|Sub-?Challenge/i.test(String(next.type || '')) ||
        (String(next.valueType || '') && (normalizeVT(next.valueType) === 'Danger'));
      next.kind = looksLikeChallenge ? 'Challenge' : 'Item';
      changed = true;
    }

    // Normalize legacy valueType spellings
    if (next.valueType) {
      const nv = normalizeVT(next.valueType);
      if (nv !== next.valueType) { next.valueType = nv; changed = true; }
    }

    return next;
  });

  if (changed) setLibrary(upgraded);
  localStorage.setItem('spirit.schema', String(SCHEMA_VERSION));
  // runs once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);


  /* ✅ FIX: lazy-init with a real object, not the function */
  const [card, setCard]         = useState(() => blankCard());
  
  // --- UI theme (Light / Dim / Spirit) ---
  const THEMES = ['light','dim','spirit','killijam','menia','seranna','nyma','mirium','zarek','joroth','spirit-overdrive'];
  const [theme, setTheme] = useState(() => localStorage.getItem('ui.theme') || 'light'); // <- THEME STATE
  
  // --- Typography + rarity palette + print mode ---
const FONT_CATALOG = {
  'Nunito': "'Nunito', system-ui, sans-serif",
  'Inter': "'Inter', system-ui, sans-serif",
  'Cinzel': "'Cinzel', serif",
  'EB Garamond': "'EB Garamond', serif",
  'Playfair Display': "'Playfair Display', serif",
  'Merriweather': "'Merriweather', serif",
  'Cormorant Garamond': "'Cormorant Garamond', serif",
  'IM Fell English SC': "'IM Fell English SC', serif",
  'Uncial Antiqua': "'Uncial Antiqua', serif"
};
const [titleFont, setTitleFont] = useState(() => localStorage.getItem('font.title') || 'Cinzel');
const [bodyFont,  setBodyFont ] = useState(() => localStorage.getItem('font.body')  || 'Inter');
const [customFonts, setCustomFonts] = useState(() => {
  try { return JSON.parse(localStorage.getItem('font.custom.list') || '[]'); } catch { return []; }
});

const [palette,   setPalette  ] = useState(() => localStorage.getItem('rarity.palette') || 'high'); // 'classic' | 'high'
const [printMode, setPrintMode] = useState(() => localStorage.getItem('print.mode')      || 'off');  // 'off' | 'gray' | 'wash'
const [accentStyle, setAccentStyle] = useState(() => localStorage.getItem('accent.style') || 'solid'); // 'solid' | 'gradient'
useEffect(() => localStorage.setItem('accent.style', accentStyle), [accentStyle]);


useEffect(()=>localStorage.setItem('font.title', titleFont), [titleFont]);
useEffect(()=>localStorage.setItem('font.body',  bodyFont ), [bodyFont ]);
useEffect(()=>localStorage.setItem('rarity.palette', palette), [palette]);
useEffect(()=>localStorage.setItem('print.mode',     printMode), [printMode]);

const allFontChoices = Object.keys(FONT_CATALOG).concat(customFonts.map(f => f.family));
const getFontStack = (family) => FONT_CATALOG[family] || `'${family}'`;

// custom font upload (now inside App so it can use setCustomFonts)
const addCustomFont = async (file) => {
  if (!file) return;
  const family = file.name.replace(/\.(woff2?|ttf|otf)$/i, '');
  try {
    const blobUrl = URL.createObjectURL(file);
    const font = new FontFace(family, `url(${blobUrl})`);
    await font.load();
    document.fonts.add(font);
    setCustomFonts(list => {
      const next = Array.from(new Set([...list, { family }].map(o => o.family)))
        .map(f => ({ family: f }));
      localStorage.setItem('font.custom.list', JSON.stringify(next));
      return next;
    });
  } catch (err) {
    console.error('Font load failed', err);
    alert('Could not load that font file. Use .woff2, .woff, .ttf, or .otf.');
  }
};

  
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ui.theme', theme);
  }, [theme]);

  useEffect(()=>localStorage.setItem('spirit.cards', JSON.stringify(library)),
            [library]);
useEffect(() => {
  ensureNunito();
}, []);

  /* 2) field helpers ------------------------------------------------------ */

  // These drive what shows in the editor dropdowns based on kind
  const isChallengeKind = (kind) => kind === 'Challenge';

  const filterEditorTypeOptions = (opts, kind) => {
    if (isChallengeKind(kind)) {
      return opts.filter(o => CHALLENGE_RARITIES.includes(o));
    }
    return opts.filter(o => !CHALLENGE_RARITIES.includes(o));
  };

  const filterEditorSizeOptions = (opts, kind) => {
    if (isChallengeKind(kind)) {
      return opts.filter(o => CHALLENGE_CATEGORIES.includes(o));
    }
    return opts.filter(o => !CHALLENGE_CATEGORIES.includes(o));
  };

  const filterEditorRarityOptions = (opts, kind) => {
    if (isChallengeKind(kind)) {
      return opts.filter(o => CHALLENGE_RARITIES.includes(o));
    }
    return opts.filter(o => !CHALLENGE_RARITIES.includes(o));
  };

  const filterEditorValueTypeOptions = (opts, kind) => {
    if (isChallengeKind(kind)) {
      // challenge uses Danger only
      return opts.filter(o => normalizeVT(o) === 'Danger');
    }
    // items: everything except Danger
    return opts.filter(o => normalizeVT(o) !== 'Danger');
  };

  const setField = (k, v) => {
    // When switching kind, clamp dependent fields so the editor doesn't keep invalid values
    if (k === 'kind') {
      const nextKind = v;

      setCard(c => {
        const next = { ...c, kind: nextKind };

        const allowedType     = new Set(filterEditorTypeOptions(typeOptions, nextKind));
        const allowedSize     = new Set(filterEditorSizeOptions(sizeOptions, nextKind));
        const allowedRarity   = new Set(filterEditorRarityOptions(rarityOptions, nextKind));
        const allowedValueTyp = new Set(filterEditorValueTypeOptions(valueTypeOptions, nextKind));

        if (!allowedType.has(String(next.type || '').trim())) next.type = '';
        if (!allowedSize.has(String(next.size || '').trim())) next.size = '';
        if (!allowedRarity.has(String(next.rarity || '').trim())) next.rarity = '';

        const vt = normalizeVT(next.valueType || '');
        if (!allowedValueTyp.has(vt)) {
          // for Challenge default to Danger, for Item clear it
          next.valueType = isChallengeKind(nextKind) ? 'Danger' : '';
        } else {
          next.valueType = vt;
        }

        return next;
      });

      return;
    }

    setCard(c => ({ ...c, [k]: v }));
  };


  /* ---------- skill helpers ---------- */
  const addSkill = () =>
    setCard(c=>({...c,
      skills:[...c.skills,
              { id:uuid(), title:'', proficiency:'', tierDots:1,
                sections:[''] }]}));
				
  const addSection = () =>
    setCard(c => ({
    ...c,
    skills: [
      ...c.skills,
      { id: uuid(), kind: 'section', title: '', proficiency: '', tierDots: 0, sections: [''] }
    ]
  }));


  const updateSkill = (id,k,v) =>
    setCard(c=>({...c,
      skills:c.skills.map(s=>s.id===id?{...s,[k]:v}:s)}));

  const removeSkill = id =>
    setCard(c=>({...c, skills:c.skills.filter(s=>s.id!==id)}));

  /* 3) library actions ---------------------------------------------------- */
  const saveCard = () => {
    setLibrary(lib=>{
      const i = lib.findIndex(c=>c.id===card.id);
      return i === -1
        ? [...lib, card]
        : lib.map((c,idx)=>idx===i? card : c);
    });
  };
  const deleteCard = (id) => {
  const victim = library.find(c => c.id === id);
  const name = victim?.name?.trim() || 'this card';

  const ok = window.confirm(`Delete “${name}”? This will remove it from your library.`);
  if (!ok) return;

  setLibrary(lib => lib.filter(c => c.id !== id));
  if (id === card.id) setCard( blankCard() );
};

  const newCard = () => setCard( blankCard() );
  const selectCard = id => {
    const found = library.find(c=>c.id===id);
    if(found) setCard( JSON.parse(JSON.stringify(found)) );
  };

// Create a new unsaved card prefilled from the current one
const duplicateCard = () => {
  setCard(c => {
    const copy = JSON.parse(JSON.stringify(c));
    copy.id = uuid();                                   // new card id
    if (Array.isArray(copy.skills)) {
      copy.skills = copy.skills.map(s => ({ ...s, id: uuid() })); // new ids for skills
    }
    if (copy.name) copy.name = `${copy.name} (copy)`;   // optional: mark as copy
    return copy;
  });
};


  /* 4) import / export (JSON) -------------------------------------------- */
  const exportLibrary = ()=> saveJson(library, 'SpiritCards.json');

const importLibrary = async (e) => {
  try {
    const file = e.target.files?.[0];
    if (!file) return;

    const payload = await loadJson(file);
    e.target.value = ''; // reset chooser so the same file can be re-imported later

    // Accept: single card object, array of cards, or { cards: [...] }
    let incoming = [];
    if (Array.isArray(payload)) {
      incoming = payload;
    } else if (payload && Array.isArray(payload.cards)) {
      incoming = payload.cards;
    } else if (payload && typeof payload === 'object') {
      incoming = [payload];
    } else {
      throw Error('JSON must be a card object, an array of cards, or { "cards": [...] }');
    }

    // Build sets of taken IDs and NAMES for conflict checks
    const takenIds   = new Set(library.map(c => c.id).filter(Boolean));
    const takenNames = new Set(library.map(c => (c.name || '').trim()).filter(Boolean));

    // Normalize and append
    const appended = [];
    for (const raw of incoming) {
      const normalized = normalizeImportedCard(raw, takenIds, takenNames);
      appended.push(normalized);
    }

    const merged = [...library, ...appended];
    setLibrary(merged);
    alert(`${appended.length} card(s) appended to library.`);
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
};

  
  // 3-stage zoom: Small / Medium / Large
const ZOOM_STEPS = [1.00, 1.25, 1.75];
const [zoom, setZoom] = useState(1.00);

  /* =========================
     4.5) FILTERING + EXPORT TOGGLE
     ========================= */

  // filter state
  const [filters, setFilters] = useState({
   q: '',
   kind: '',
   type: '',
   rarity: '',
   size: '',
   version: '',
    vMin: '', vMax: '',
    profsMode: 'ANY',
    profs: {}
  });

  // batch export respects filters (when active)
  const [batchUseFiltered, setBatchUseFiltered] = useState(true);

  // options gathered dynamically from library
  const {
  typeOptions, rarityOptions, sizeOptions, profOptions,
  valueTypeOptions, artOptions, versionOptions
} = useMemo(() => {
  const types = uniqSorted([
    // seed item types if you like:
    'Weapon','Outfit','Tool','Resource',
    // and the challenge types you want in Type:
    'Core Challenge','Sub-Challenge',
    ...library.map(c => c.type)
	  ]);
  const rar   = uniqSorted([
    'Common','Crafted','Enigmatic','Storied','Primordial','Exotic','Otherworldly',
	...CHALLENGE_RARITIES,'Core Challenge','Sub-Challenge',
    ...library.map(c => c.rarity)
  ]);
  
  const sizeLabel = card.kind === 'Challenge' ? 'Domain' : 'Size';
  
  const sizes = uniqSorted([
    'Light','Medium','Heavy','Fixed',
	...CHALLENGE_CATEGORIES, 'Combat','Environmental','Social','Exploration','Puzzle','Hazard','Trap','Affliction',
    ...library.map(c => c.size)
  ]);
  const profs = uniqSorted(
    library.flatMap(c => (c.skills || []).map(s => s?.proficiency || ''))
  );

  /* ✅ singularize here and drop the old “Assets” seed */
  const vTypes = uniqSorted([
    'Coin','Asset','Influence','Danger',
    ...library.map(c => normalizeVT(c.valueType))
  ]);

  const arts = uniqSorted(library.map(c => c.art));
  const vers = uniqSorted(library.map(c => c.version));

  return {
    typeOptions: types,
    rarityOptions: rar,
    sizeOptions: sizes,
    profOptions: profs,
    valueTypeOptions: vTypes,
    artOptions: arts,
    versionOptions: vers
  };
}, [library]);

  const toggleProf = (p) => {
    setFilters(f => ({
      ...f,
      profs: { ...f.profs, [p]: !f.profs[p] }
    }));
  };

  const clearFilters = () => {
    setFilters({
   q: '', kind: '', type: '', rarity: '', size: '', version: '',
      vMin: '', vMax: '',
      profsMode: 'ANY',
      profs: {}
    });
  };

  const filtersActive = useMemo(() => {
    if (filters.q.trim()) return true;
	if (filters.kind) return true;     
   if (filters.type || filters.rarity || filters.size || filters.version) return true;
    if (filters.vMin !== '' || filters.vMax !== '') return true;
    if (Object.values(filters.profs).some(Boolean)) return true;
    return false;
  }, [filters]);

  const filteredLibrary = useMemo(() => {
    const activeProfs = Object.keys(filters.profs).filter(k => filters.profs[k]);

    return library.filter(c => {
      if (filters.q) {
        const hit = includesCI(c.name, filters.q) || includesCI(c.flavor, filters.q);
        if (!hit) return false;
      }

	  if (filters.kind && c.kind !== filters.kind) return false;  
      if (filters.type && String(c.type).trim() !== filters.type) return false;
      if (filters.rarity && String(c.rarity).trim() !== filters.rarity) return false;
      if (filters.size && String(c.size).trim() !== filters.size) return false;
	  if (filters.version && String(c.version || '').trim() !== filters.version) return false;

      const v = Number.isFinite(+c.value) ? +c.value : 0;
      if (filters.vMin !== '' && v < +filters.vMin) return false;
      if (filters.vMax !== '' && v > +filters.vMax) return false;

      if (activeProfs.length) {
        const cardProfs = new Set(
          (c.skills || [])
            .map(s => String(s?.proficiency || '').trim())
            .filter(Boolean)
        );

        if (filters.profsMode === 'ANY') {
          if (!activeProfs.some(p => cardProfs.has(p))) return false;
        } else {
          if (!activeProfs.every(p => cardProfs.has(p))) return false;
        }
      }

      return true;
    });
  }, [library, filters]);

// === JSON exports ===
const exportCurrentCardJson = () => {
  const fname = `${safeFileName(card.name || 'SpiritCard')}.json`;
  saveJson(card, fname);
};

const exportFilteredCardsJson = () => {
  const src = filtersActive ? filteredLibrary : library;
  const scope = filtersActive ? `filtered_${src.length}` : `all_${src.length}`;
  saveJson(src, `SpiritCards_${scope}.json`);
};



  /* ------------------------- EXPORT CORE ------------------------- */

  const enterExportMode = () => document.body.classList.add('export-mode');
  const leaveExportMode = () => document.body.classList.remove('export-mode');

  async function exportPDF() {
  const frontEl = document.querySelector('.card .front');
  const backEl  = document.querySelector('.card .back');
  const bars    = document.querySelectorAll('.title-row');

  const save = {
    f:frontEl?.style.transform, b:backEl?.style.transform,
    ov:[...bars].map(el => el.style.overflow)
  };

  try {
    enterExportMode();
    if (frontEl) frontEl.style.transform = 'none';
    if (backEl)  backEl .style.transform = 'none';
    bars.forEach(el => { el.style.overflow = 'visible'; });

    // ✅ 1) Ensure Nunito is available BEFORE any swapping
    if (document.fonts && document.fonts.load) {
      await Promise.all([
        document.fonts.load('400 16px "Nunito"'),
        document.fonts.load('600 16px "Nunito"'),
        document.fonts.load('700 16px "Nunito"'),
        document.fonts.load('800 16px "Nunito"'),
        document.fonts.load('900 16px "Nunito"'),
      ]);
      await document.fonts.ready;
    }

    // ✅ 2) Now do the swap (so PNGs use Nunito)
    const restoreFront = swapSvgsForPngs(frontEl);
    const restoreBack  = swapSvgsForPngs(backEl);
    await waitImages(frontEl); 
    await waitImages(backEl);

    // html2canvas options (keep your onclone that injects Nunito + export CSS)
    const opts = {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      onclone: (doc) => {
        doc.body.classList.add('export-mode');
        if (!doc.querySelector('link[data-nunito]')) {
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
          link.setAttribute('data-nunito', '');
          doc.head.appendChild(link);
        }
        const style = doc.createElement('style');
        style.id = 'export-safe';
        style.textContent = EXPORT_SAFE_CSS;
        doc.head.appendChild(style);
      }
    };

      const frontCanvas = await html2canvas(frontEl, opts);
      const backCanvas  = await html2canvas(backEl , opts);

      const w = frontCanvas.width, h = frontCanvas.height;
      const pdf = new jsPDF({
        orientation:'landscape',
        unit:'pt',
        precision: 16,
        format:[ w*2 + 60, h + 60 ]
      });
      const m = 30;
      pdf.addImage(frontCanvas, 'PNG', m      , m, w, h);
      pdf.addImage(backCanvas ,  'PNG', m + w , m, w, h);
      pdf.save(`${card.name || 'SpiritCard'}.pdf`);

      restoreFront(); restoreBack();
    } finally {
      leaveExportMode();
      if (frontEl) frontEl.style.transform = save.f || '';
      if (backEl)  backEl .style.transform = save.b || '';
      bars.forEach((el,i)=>{ el.style.overflow = save.ov[i] || ''; });
    }
  }

  const getActiveSide = () => {
    const root = document.querySelector('.card');
    return root?.classList.contains('flip') ? 'back' : 'front';
  };

  const setCardAndWait = async (data, overrides = {}) => {
    const next = { ...JSON.parse(JSON.stringify(data)), ...overrides };
    setCard(next);
    await raf(); await raf();
  };

  const captureSide = async (side = 'front') => {
  const el  = document.querySelector(`.card .${side}`);
  const fr  = document.querySelector('.card .front');
  const bk  = document.querySelector('.card .back');
  const bars = el?.querySelectorAll('.title-row') || {};

  const save = {
    f: fr?.style.transform, b: bk?.style.transform,
    ov: Array.from(bars).map(b => b.style.overflow)
  };

  enterExportMode();
  if (fr) fr.style.transform = 'none';
  if (bk) bk.style.transform = 'none';
  Array.from(bars).forEach(b => { b.style.overflow = 'visible'; });

  // ✅ 1) Ensure Nunito first
  if (document.fonts && document.fonts.load) {
    await Promise.all([
      document.fonts.load('400 16px "Nunito"'),
      document.fonts.load('600 16px "Nunito"'),
      document.fonts.load('700 16px "Nunito"'),
      document.fonts.load('800 16px "Nunito"'),
      document.fonts.load('900 16px "Nunito"'),
    ]);
    await document.fonts.ready;
  }

  // ✅ 2) Then swap to PNGs
  const restore = swapSvgsForPngs(el);
  await waitImages(el);

  const opts = {
    backgroundColor: '#ffffff',
    scale: 2,
    useCORS: true,
    onclone: (doc) => {
      doc.body.classList.add('export-mode');
      if (!doc.querySelector('link[data-nunito]')) {
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap';
        link.setAttribute('data-nunito', '');
        doc.head.appendChild(link);
      }
      const style = doc.createElement('style');
      style.id = 'export-safe';
      style.textContent = EXPORT_SAFE_CSS;
      doc.head.appendChild(style);
    }
  };

  const canvas = await html2canvas(el, opts);

  restore();
  leaveExportMode();
  if (fr) fr.style.transform = save.f || '';
  if (bk) bk.style.transform = save.b || '';
  Array.from(bars).forEach((b,i)=>{ b.style.overflow = save.ov[i] || ''; });

  return canvas;
};


  /* === EXACT SIZE LAYOUT: 63×88 mm ===================================== */
  const A4_W = 210;
  const A4_H = 297;
  const COLS = 3, ROWS = 3;
  const CARD_W = 63;
  const CARD_H = 88;

  const makeA4NineUpExact = (images) => {
    const pdf = new jsPDF({
      format:'a4',
      unit:'mm',
      orientation:'portrait',
      precision: 16
    });

    const gridW = COLS * CARD_W;
    const gridH = ROWS * CARD_H;
    const startX = (A4_W - gridW) / 2;
    const startY = (A4_H - gridH) / 2;

    images.forEach((img, idx) => {
      if (idx > 0 && idx % (COLS*ROWS) === 0) pdf.addPage();

      const i   = idx % (COLS*ROWS);
      const row = Math.floor(i / COLS);
      const col = i % COLS;

      const x = startX + col * CARD_W;
      const y = startY + row * CARD_H;

      pdf.addImage(img.canvas, 'PNG', x, y, CARD_W, CARD_H);
    });

    return pdf;
  };

  const getExportSource = () => {
    const useFiltered = batchUseFiltered && filtersActive;
    return useFiltered ? filteredLibrary : library;
  };

  const exportBatchActive = async () => {
  const src = getExportSource();
  if (!src.length) return alert('No cards to export.');
  const side = getActiveSide();
  const canvases = [];
  for (let i=0; i<src.length; i++) {
    await setCardAndWait(src[i]);
    const canvas = await captureSide(side);
    canvases.push({ canvas });
  }
  const pdf = makeA4NineUpExact(canvases);
  const suffix = batchUseFiltered && filtersActive ? '_FILTERED' : '';
  pdf.save(`SpiritCards_${side}_9up_exact${suffix}.pdf`);
};


  const exportBatchFrontsBacks = async () => {
  const src = getExportSource();
  if (!src.length) return alert('No cards to export.');

  const fronts = [];
  for (let i=0; i<src.length; i++) {
    await setCardAndWait(src[i]);
    fronts.push({ canvas: await captureSide('front') });
  }
  const pdf = makeA4NineUpExact(fronts);

  const backs = [];
  for (let i=0; i<src.length; i++) {
    await setCardAndWait(src[i]);
    backs.push({ canvas: await captureSide('back') });
  }
    backs.forEach((img, idx) => {
      if (idx % (COLS*ROWS) === 0) pdf.addPage();

      const i   = idx % (COLS*ROWS);
      const row = Math.floor(i / COLS);
      const col = i % COLS;

      const gridW = COLS * CARD_W;
      const gridH = ROWS * CARD_H;
      const startX = (A4_W - gridW) / 2;
      const startY = (A4_H - gridH) / 2;

      const x = startX + col * CARD_W;
      const y = startY + row * CARD_H;

      pdf.addImage(img.canvas, 'PNG', x, y, CARD_W, CARD_H);
    });

    const suffix = batchUseFiltered && filtersActive ? '_FILTERED' : '';
    pdf.save(`SpiritCards_fronts_then_backs_9up_exact${suffix}.pdf`);
  };

  /* ---------------------------------------------------------------------- */
  
  // right above the TYPE / SIZE / RARITY / VALUE blocks
  const isChallenge = card.kind === 'Challenge';
  const typePh        = isChallenge ? 'Challenge Type'      : 'Type';
  const sizeLabel     = isChallenge ? 'Domain — required'    : 'Size — required';
  const rarityLabel   = isChallenge ? 'Challenge Kind — required' : 'Rarity — required';
  const valuePh       = isChallenge ? 'Danger (dots)'        : 'Value';
  const valueTypePh   = isChallenge ? 'Danger Type'          : 'Value Type';

  // Editor-only option lists (filtered by Item vs Challenge)
  const editorTypeOptions = useMemo(
    () => filterEditorTypeOptions(typeOptions, card.kind),
    [typeOptions, card.kind]
  );
  const editorSizeOptions = useMemo(
    () => filterEditorSizeOptions(sizeOptions, card.kind),
    [sizeOptions, card.kind]
  );
  const editorRarityOptions = useMemo(
    () => filterEditorRarityOptions(rarityOptions, card.kind),
    [rarityOptions, card.kind]
  );
  const editorValueTypeOptions = useMemo(
    () => filterEditorValueTypeOptions(valueTypeOptions, card.kind),
    [valueTypeOptions, card.kind]
  );

  
  return (
  <div
  className="app-grid"
  style={{
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 16,
    alignItems: 'start'
  }}
>


    {/* 1) CARD — live preview (sticky) */}
    <aside
      style={{
            gridColumn: '1',
    position: 'sticky',
    top: 16,
    alignSelf: 'flex-start',
    maxHeight: 'calc(100vh - 32px)',
    overflow: 'visible',
    zIndex: 50
      }}
    >
      {/* Zoom toolbar */}
      <div className="preview-toolbar">
        <div className="zoom-group">
          {ZOOM_STEPS.map((z, i) => (
            <button
              key={z}
              className={`zoom-btn ${zoom === z ? 'on' : ''}`}
              onClick={() => setZoom(z)}
              aria-pressed={zoom === z}
            >
              {['S','M','L'][i]}
            </button>
          ))}
        </div>
      </div>

      {/* Zoomed preview */}
      <div style={{ display:'flex', justifyContent:'center' }}>
        <div
          className="preview-wrap"
          style={{
            width:  `360px`,
            height: '504px',
            position: 'relative',
			overflow: 'visible',
			pointerEvents: 'none'           // NEW: let clicks fall through outside the card
          }}
        >
          <div className="preview-scale" style={{ 
		  transform:`scale(${zoom})`, 
		  transformOrigin:'top left',
		  pointerEvents: 'none'
		  }}>
            <CardPreview
              card={card}
              palette={palette}
              printMode={printMode}
              titleFont={getFontStack(titleFont)}
              bodyFont={getFontStack(bodyFont)}
			  accentStyle={accentStyle}
            />
          </div>
        </div>
      </div>
    </aside>

    {/* 2) SKILLS — its own column, scrollable */}
    <section
  className="skills-editor-panel"
  style={{
    gridColumn: '2',
    position: 'sticky',
    top: 16,
    alignSelf: 'flex-start',
    maxHeight: 'calc(100vh - 32px)',
    overflowY: 'auto',
    overflowX: 'hidden'
  }}
>

      <h2 style={{ marginTop: 0 }}>Skills</h2>

      {/* Add new paragraph/skill lives here so editor column won’t jump */}
      <div style={{ marginBottom: 8 }}>
        <button onClick={addSkill}>+ Paragraph / Skill</button>
		<button onClick={addSection}>+ Section</button>    {/* NEW */}
      </div>

      {card.skills.map(s => (
        <SkillEditor
          key={s.id}
          s={s}
          profs={profOptions}
          onChange={(k, v) => updateSkill(s.id, k, v)}
          onDelete={() => removeSkill(s.id)}
        />
      ))}
    </section>

    {/* 3) CARD EDITOR — fields & save/new only (no filters/export here) */}
    <section
      style={{
        gridColumn: '3',
        position: 'sticky',
        top: 16,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 32px)',
        overflowY: 'auto',
overflowX: 'hidden'

      }}
    >
      <h2 style={{ marginTop: 0 }}>Card Editor</h2>

	{/* KIND */}
	<div className="field-row">
	<select value={card.kind} onChange={e=>setField('kind', e.target.value)}>
		<option>Item</option>
		<option>Challenge</option>
	</select>
	</div>

      {/* NAME */}
      <div className="field-row">
        <input
          placeholder="Name"
          className={isBlank(card.name) ? 'invalid' : ''}
          value={card.name}
          onChange={e => setField('name', e.target.value)}
        />
        <Warn show={isBlank(card.name)} />
      </div>


      {/* TYPE (datalist) */}
      <div className="field-row">
        <input
  placeholder={typePh}
  className={isBlank(card.type) ? 'invalid' : ''}
  value={card.type}
  list="typeDL"
  onChange={e => setField('type', e.target.value)}
/>
<datalist id="typeDL">
  {editorTypeOptions.map(o => <option key={o} value={o} />)}
</datalist>

        <Warn show={isBlank(card.type)} />
      </div>

      {/* SIZE */}
      <div className="field-row">
        <select
          className={isBlank(card.size) ? 'invalid' : ''}
          value={card.size || ''}
          onChange={e => setField('size', e.target.value)}
        >
          <option value="" disabled>{sizeLabel}</option>
          {editorSizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <Warn show={isBlank(card.size)} />
      </div>

      {/* RARITY */}
      <div className="field-row">
        <select
          className={isBlank(card.rarity) ? 'invalid' : ''}
          value={card.rarity || ''}
          onChange={e => setField('rarity', e.target.value)}
        >
          <option value="" disabled>{rarityLabel}</option>
          {editorRarityOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <Warn show={isBlank(card.rarity)} />
      </div>

      {/* VALUE */}
      <div className="field-row">
        <input
          type="number"
          placeholder={valuePh}
          min={0} step={1}
          className={card.value === '' ? 'invalid' : ''}
          value={card.value === '' ? '' : card.value}
          onChange={e=>{
            const v = e.target.value;
            if (v === '') { setField('value',''); return; }
            const n = Math.max(0, Number(v));
            setField('value', Number.isFinite(n) ? n : '');
          }}
        />
        <Warn show={card.value === ''} />
      </div>

      {/* VALUE TYPE */}
      <div className="field-row">
        <input
          placeholder={valueTypePh}
          className={isBlank(card.valueType) ? 'invalid' : ''}
          value={card.valueType}
          list="valueTypeDL"
          onChange={e => setField('valueType', normalizeVT(e.target.value))}
        />
        <datalist id="valueTypeDL">
  {editorValueTypeOptions.map(o => <option key={o} value={o} />)}
</datalist>

        <Warn show={isBlank(card.valueType)} />
      </div>

      {/* ART */}
      <div className="field-row">
        <input
          placeholder="Art file (Illustration_*.png)"
          className={isBlank(card.art) ? 'invalid' : ''}
          value={card.art}
          list="artDL"
          onChange={e => setField('art', e.target.value)}
        />
        <Warn show={isBlank(card.art)} />
      </div>
      <datalist id="artDL">{artOptions.map(o => <option key={o} value={o} />)}</datalist>

      {/* FLAVOR */}
      <div className="field-row">
        <textarea
          placeholder="Flavor text"
          className={isBlank(card.flavor) ? 'invalid' : ''}
          value={card.flavor}
          onChange={e => setField('flavor', e.target.value)}
        />
        <Warn show={isBlank(card.flavor)} />
      </div>
	  
	       {/* VERSION (hidden meta; never rendered on card) */}
     <div className="field-row">
       <input
         placeholder="Version (hidden)"
         value={card.version || ''}
         list="versionDL"
         onChange={e => setField('version', e.target.value)}
       />
     </div>
     <datalist id="versionDL">
       {versionOptions.map(o => <option key={o} value={o} />)}
     </datalist>
	   


      {/* SAVE / NEW (keep editor actions here) */}
      <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
        <button onClick={saveCard}>💾 Save / Update</button>
        <button onClick={newCard}>✱ New</button>
		  <button
    onClick={duplicateCard}
    title="Make a new unsaved card pre-filled with this one"
  >
    ⎘ Duplicate as New
  </button>
      </div>
    </section>
	
	

    {/* 4) LIBRARY — Search, Filters, Library, Export, and (bottom) Fonts/Palette */}
        <section
      style={{
        gridColumn: '4',
        position: 'sticky',
        top: 16,
        alignSelf: 'flex-start',
        maxHeight: 'calc(100vh - 32px)',
        overflow: 'hidden',

        maxHeight: 'calc(100vh - 32px)',
        overflow: 'auto',
        paddingRight: 4

      }}
    >

      {/* Theme (moved here) */}
      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:8, marginBottom:8, fontSize:12 }}>
        <span>Theme</span>
        <select value={theme} onChange={e => setTheme(e.target.value)} style={{ maxWidth: 180 }}>
          <option value="light">Light</option>
          <option value="dim">Dim</option>
          <option value="spirit">Spirit</option>
          <option value="killijam">Killijam</option>
          <option value="menia">Menia</option>
          <option value="seranna">Seranna</option>
          <option value="nyma">Nyma</option>
          <option value="mirium">Mirium</option>
          <option value="zarek">Zarek</option>
          <option value="joroth">Joroth</option>
          <option value="spirit-overdrive">Spirit Overdrive</option>
        </select>
      </div>

            {/* ===== FILTERS ===== */}
      <details className="panel" open>
        <summary className="panel-summary">
          <span>Library Filters</span>
          <span style={{ fontSize: 12, opacity: 0.8 }}>
            {filtersActive ? '• active' : '• none'}
          </span>
        </summary>


        {/* Search */}
        <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
          <input
            placeholder="Search by name or flavor…"
            value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
          />
              </div>


 {/* Selects */}
<div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:6, marginBottom:8 }}>
  <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
    <option value="">Type (any)</option>
    {typeOptions.map(o => <option key={o} value={o}>{o}</option>)}
  </select>

<select
  value={filters.rarity ?? ""}
  onChange={(e) => setFilters((f) => ({ ...f, rarity: e.target.value }))}
>
  <option value="">Rarity (any)</option>
  {rarityOptions.map((o) => (
    <option key={o} value={o}>
      {o}
    </option>
  ))}
</select>


  <select value={filters.size} onChange={e => setFilters(f => ({ ...f, size: e.target.value }))}>
    <option value="">Size (any)</option>
    {sizeOptions.map(o => <option key={o} value={o}>{o}</option>)}
  </select>

  {/* NEW: Version */}
  <select value={filters.version} onChange={e => setFilters(f => ({ ...f, version: e.target.value }))}>
    <option value="">Version (any)</option>
    {versionOptions.map(o => <option key={o} value={o}>{o}</option>)}
  </select>
</div>

<div className="filter-row">
  <label>Kind</label>
  <select value={filters.kind} onChange={e=>setFilters(f=>({...f, kind:e.target.value}))}>
    <option value="">Any</option>
    <option value="Item">Item</option>
    <option value="Challenge">Challenge</option>
  </select>
</div>



        {/* Value range */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:8 }}>
          <input type="number" placeholder="Min value" value={filters.vMin}
                 onChange={e => setFilters(f => ({ ...f, vMin: e.target.value }))}/>
          <input type="number" placeholder="Max value" value={filters.vMax}
                 onChange={e => setFilters(f => ({ ...f, vMax: e.target.value }))}/>
        </div>

        {/* Proficiencies */}
        <div style={{ display:'grid', gap:6 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <strong>Proficiencies</strong>
            <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
              Match:
              <select
                value={filters.profsMode}
                onChange={e => setFilters(f => ({ ...f, profsMode: e.target.value }))}
              >
                <option value="ANY">Any</option>
                <option value="ALL">All</option>
              </select>
            </label>
          </div>

          <div
            style={{
              border:'1px solid var(--ui-border)',
              background:'var(--ui-surface)',
              borderRadius:6,
              padding:6,
              maxHeight:140,
              overflow:'auto',
              display:'grid',
              gridTemplateColumns:'1fr',
              gap:4
            }}
          >
            {profOptions.length === 0 && (
              <div style={{ fontSize:12, color:'var(--ui-muted)' }}>No proficiencies in library yet.</div>
            )}
            {profOptions.map(p => (
              <label key={p} className="prof-row">
                <span className="ptext" title={p}>{p}</span>
                <input type="checkbox" checked={!!filters.profs[p]} onChange={() => toggleProf(p)} />
              </label>
            ))}
          </div>
        </div>

        {/* Batch toggle + status */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:8 }}>
          <label className="toggle-row small" title="Apply current filters when exporting the batch">
            <span>Use filters for batch export</span>
            <input
              type="checkbox"
              checked={batchUseFiltered}
              onChange={e => setBatchUseFiltered(e.target.checked)}
            />
          </label>
          <div style={{ fontSize: 12 }}>
            {filtersActive ? 'Filters active' : 'No filters'}
            {batchUseFiltered && filtersActive ? ` • Exporting ${filteredLibrary.length}` : ''}
          </div>
        </div>

        <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
          <button onClick={clearFilters}>Clear Filters</button>
          <div style={{ fontSize:12, alignSelf:'center' }}>
            Showing <strong>{filteredLibrary.length}</strong> of {library.length}
          </div>
        </div>
      </details>

                  {/* ===== LIBRARY LIST ===== */}
      <div>
        <h3 style={{ margin: 0 }}>
          Library ({filteredLibrary.length} / {library.length})
        </h3>

        <ul className="lib-list" style={{ marginTop: 8 }}>


          {filteredLibrary.map(c => (
            <li key={c.id} className={`lib-item ${c.id === card.id ? 'on' : ''}`}>
              <div
                onClick={() => selectCard(c.id)}
                className="lib-main"
                title={`${c.type || 'Type?'} • ${c.rarity || 'Rarity?'} • ${c.size || 'Size?'} • Value ${c.value ?? 0}`}
              >
                <div className="lib-name">{c.name || '[unnamed]'}</div>
                <div className="lib-meta">
                  <span>{c.type || '—'}</span>
                  <span>• {c.rarity || '—'}</span>
                  <span>• {c.size || '—'}</span>
                  <span>• Value {Number.isFinite(+c.value) ? +c.value : 0} {c.valueType || ''}</span>
				     {c.version ? <span>• v {c.version}</span> : null}
                  {!!(c.skills || []).length && (
                    <span className="lib-profs" style={{ whiteSpace:'nowrap' }}>
                      • {Array.from(new Set((c.skills || []).map(s => s?.proficiency || '').filter(Boolean)))
                          .slice(0, 2).join(', ')}
                      {Array.from(new Set((c.skills || []).map(s => s?.proficiency || '').filter(Boolean))).length > 2 ? '…' : ''}
                    </span>
                  )}
                </div>
              </div>
              <button
  onClick={() => deleteCard(c.id)}
  className="lib-del"
  title={`Delete “${c.name}”`}
  aria-label={`Delete ${c.name}`}
>
  ×
</button>
            </li>
          ))}
      </ul>
      </div>


      {/* ===== LIBRARY JSON ===== */}
      <details className="panel">
        <summary className="panel-summary">
          <span>Library JSON</span>
        </summary>

        <div style={{ paddingTop: 8 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <button onClick={exportLibrary}>⇩ Export JSON (all)</button>
            <button onClick={exportFilteredCardsJson}>
              ⇩ Export JSON {filtersActive ? `(filtered — ${filteredLibrary.length})` : `(all — ${library.length})`}
            </button>
            <button onClick={exportCurrentCardJson}>⇩ Export JSON (current card)</button>

            <label style={{ display:'flex', flexDirection:'column', gap:4 }}>
              ⇧ Import JSON
              <input type="file" accept=".json" onChange={importLibrary} />
            </label>
          </div>
        </div>
      </details>

      {/* ===== EXPORT SETTINGS (moved here) ===== */}
            <details className="panel">
        <summary className="panel-summary">
          <span>Export</span>
        </summary>
        <div className="panel-body-scroll">


        {/* Printer Mode (moved from editor) */}
        <label className="toggle-row" style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:6 }}>
          <span>Printer Mode</span>
          <select value={printMode} onChange={e=>setPrintMode(e.target.value)}>
            <option value="off">Off</option>
            <option value="gray">Gray (ink saver)</option>
            <option value="wash">Washed (low-ink color)</option>
          </select>
        </label>

        <div style={{ marginTop: 8, display:'grid', gap:6 }}>
          <button onClick={exportPDF}>⇩ PDF (current spread)</button>
          <button onClick={exportBatchActive}>
            ⇩ Batch 9-up (active side)
            {batchUseFiltered && filtersActive ? ` — ${filteredLibrary.length}` : ''}
          </button>
          <button onClick={exportBatchFrontsBacks}>
            ⇩ Batch 9-up (fronts → backs)
            {batchUseFiltered && filtersActive ? ` — ${filteredLibrary.length}` : ''}
          </button>
        </div>
              </div>
      </details>

      {/* ===== BOTTOM: Fonts + Rarity palette ===== */}

            <details className="panel">
        <summary className="panel-summary">
          <span>Display (Fonts & Palette)</span>
        </summary>
        <div className="panel-body-scroll">

        <div style={{ display:'grid', gap:8 }}>
          <label style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:6 }}>
            <span style={{ whiteSpace:'nowrap' }}>Title font</span>
            <select value={titleFont} onChange={e=>setTitleFont(e.target.value)}>
              {allFontChoices.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>

          <label style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:6 }}>
            <span style={{ whiteSpace:'nowrap' }}>Body font</span>
            <select value={bodyFont} onChange={e=>setBodyFont(e.target.value)}>
              {allFontChoices.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>

          <label style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:6 }}>
            <span style={{ whiteSpace:'nowrap' }}>Rarity palette</span>
            <select value={palette} onChange={e=>setPalette(e.target.value)}>
              <option value="high">High-contrast (print-safe)</option>
              <option value="classic">Classic</option>
            </select>
          </label>
		  
		  <label style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:6 }}>
  <span>Accent style</span>
  <select value={accentStyle} onChange={e=>setAccentStyle(e.target.value)}>
    <option value="solid">Solid</option>
    <option value="gradient">Sliding gradient</option>
  </select>
</label>


          <label className="btn" style={{ display:'grid', gridTemplateColumns:'auto 1fr', alignItems:'center', gap:6 }}>
            <span>+ Custom font</span>
            <input type="file" accept=".woff,.woff2,.ttf,.otf" onChange={e=>addCustomFont(e.target.files[0])} />
          </label>
        </div>
              </div>
      </details>
    </section>

  </div>
);
}