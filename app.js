// =====================================================================
// API-203M scroll site — app.js
// ES module, no build step. Loads Supabase client from CDN.
// =====================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// config.js is user-provided (gitignored). Fall back to config.example.js
// so the static parts of the site still render when nobody has set up
// Supabase yet — reactions/comments will show a "sign in" prompt.
let cfg;
try {
  cfg = await import("./config.js");
} catch {
  console.warn("config.js not found — using example stub. Reactions/comments disabled.");
  cfg = await import("./config.example.js");
}

const supabase = (cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT"))
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

const REACTION_EMOJIS = [
  { key: "thumbs_up",   char: "👍" },
  { key: "thumbs_down", char: "👎" },
  { key: "lightbulb",   char: "💡" },
  { key: "heart",       char: "❤️" },
  { key: "thinking",    char: "🤔" },
  { key: "confused",    char: "😕" },
  { key: "angry",       char: "😠" },
];

// =====================================================================
// Data loading
// =====================================================================

// Cache-buster: every page load fetches fresh public/data/* from GitHub Pages
// so stale CDN copies don't stick after a republish. Using one stable value
// per load (not Date.now() per call) means the browser can still cache within
// a single session.
const CACHE_BUST = `?v=${Date.now()}`;

async function loadJSON(path) {
  const res = await fetch(path + CACHE_BUST);
  if (!res.ok) return null;
  return res.json();
}

async function loadJSONL(path) {
  const res = await fetch(path + CACHE_BUST);
  if (!res.ok) return [];
  const text = await res.text();
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

// =====================================================================
// Section renderers
// =====================================================================

// Markdown → HTML. Handles:
//   # / ## / ### headings
//   **bold**, *italic*
//   [link](url)
//   >> pull quote (whole paragraph)
//   [^1] footnote reference → jumps to footnote body
//   [^1]: footnote body
//   --- horizontal rule
// The leading-sentence-bolding of paragraphs is done via **...** in the source,
// not auto-detected, so the author controls which sentences pop.
function mdToHTML(md) {
  const lines = md.split("\n");
  const out = [];
  const footnotes = {};
  const footnoteOrder = [];

  let para = [];
  const flush = () => {
    if (!para.length) return;
    const joined = para.join(" ");
    // Detect pull-quote paragraph marker
    if (joined.startsWith(">> ")) {
      out.push(`<blockquote class="pull-quote-memo">${inline(joined.slice(3))}</blockquote>`);
    } else {
      out.push(`<p>${inline(joined)}</p>`);
    }
    para = [];
  };

  for (let raw of lines) {
    // Footnote body (must come before generic [^...] detection)
    const fnDef = raw.match(/^\[\^(\w+)\]:\s*(.*)$/);
    if (fnDef) {
      flush();
      footnotes[fnDef[1]] = fnDef[2];
      footnoteOrder.push(fnDef[1]);
      continue;
    }
    // Continuation of a footnote body (indented or running paragraph after a [^n]:)
    if (footnoteOrder.length && para.length === 0 && out.length && raw && !raw.startsWith("#") && !raw.startsWith("---") && !raw.startsWith(">>")) {
      // Skip — we don't support multi-line footnote bodies; authors should keep them on one line.
    }
    if (raw === "") { flush(); continue; }
    if (raw === "---") { flush(); out.push("<hr>"); continue; }
    if (raw.startsWith("### ")) { flush(); out.push(`<h3>${inline(raw.slice(4))}</h3>`); continue; }
    if (raw.startsWith("## "))  { flush(); out.push(`<h2>${inline(raw.slice(3))}</h2>`); continue; }
    if (raw.startsWith("# "))   { flush(); out.push(`<h1>${inline(raw.slice(2))}</h1>`); continue; }
    para.push(raw);
  }
  flush();

  if (footnoteOrder.length) {
    out.push('<div class="footnotes-list"><hr class="footnotes-rule"><ol>');
    footnoteOrder.forEach((k) => {
      out.push(`<li id="fn-${k}">${inline(footnotes[k])} <a href="#fnref-${k}" class="fn-back" aria-label="back to reference">↩</a></li>`);
    });
    out.push("</ol></div>");
  }

  return out.join("\n");

  // Inline formatting. Order matters: links BEFORE italics (to avoid `*link*` clashes).
  function inline(s) {
    let x = escape(s);
    // Bold
    x = x.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // Links [text](url)
    x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, text, url) =>
      `<a href="${url}" target="_blank" rel="noopener">${text}</a>`
    );
    // Italic — use asterisks only when flanked by non-word chars
    x = x.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,!?;:]|$)/g, '$1<em>$2</em>');
    // Footnote references [^n] → superscript link
    x = x.replace(/\[\^(\w+)\]/g, (_, k) =>
      `<sup class="fn-ref"><a id="fnref-${k}" href="#fn-${k}">${k}</a></sup>`
    );
    return x;
  }
}

async function renderMemo() {
  const res = await fetch("public/memo.md" + CACHE_BUST);
  if (!res.ok) return;
  const md = await res.text();

  // Split: everything up through (and including) the SECOND body paragraph
  // after the first "##" heading goes into the intro. Everything else goes
  // into the collapsible "rest" block. Footnote bodies always live in the
  // rest block so they render together with the text that references them.
  const { intro, rest } = splitMemo(md);

  const introEl = document.getElementById("memo-intro");
  const restEl  = document.getElementById("memo-rest");
  if (introEl) introEl.innerHTML = injectEmbeds(mdToHTML(intro));
  if (restEl)  restEl.innerHTML  = injectEmbeds(mdToHTML(rest));
}

// Replace [[SONG_VOTE]] placeholder (escaped to &#91;...&#93; by the md renderer)
// with the embedded Google Form iframe + an "attention check" framing.
function injectEmbeds(html) {
  const SONG_VOTE_HTML = `
    <aside class="memo-attention-check">
      <div class="memo-attention-label">attention check</div>
      <p class="memo-attention-lede">
        Still with me? Pick the song that should play before class starts on Tuesday.
      </p>
      <div class="memo-embed">
        <iframe src="https://docs.google.com/forms/d/e/1FAIpQLSeye8YnCVBZxC86YN3qzgW_58iPsJWt2PgLCgWYRS0DouTdaw/viewform?embedded=true" width="640" height="532" frameborder="0" marginheight="0" marginwidth="0" loading="lazy">Loading…</iframe>
      </div>
    </aside>`;
  return html
    .replace(/<p>\s*\[\[SONG_VOTE\]\]\s*<\/p>/g, SONG_VOTE_HTML)
    .replace(/\[\[SONG_VOTE\]\]/g, SONG_VOTE_HTML);
}

// Split the memo so the intro cuts off MID-SENTENCE in the 2nd paragraph.
// Specifically, we cut after the phrase "we do not yet know the right" —
// leaving the reader hanging, which makes "read the rest" irresistible.
// Everything after that point goes into the collapsible block.
function splitMemo(md) {
  const CUT_MARKER = "we do not yet know the right";
  const idx = md.indexOf(CUT_MARKER);
  if (idx === -1) {
    // Fallback to paragraph-based split if the marker moved
    const paras = md.split("\n\n");
    return { intro: paras.slice(0, 3).join("\n\n"), rest: paras.slice(3).join("\n\n") };
  }
  // Extend to include the word immediately after the marker
  const cut = idx + CUT_MARKER.length;
  const intro = md.slice(0, cut) + "...";
  const rest = "..." + md.slice(cut);
  return { intro, rest };
}

async function renderMeta() {
  const meta = await loadJSON("public/data/meta.json");
  if (!meta) return;
  document.getElementById("fg-count").textContent = meta.fg_count ?? "—";
  document.getElementById("segment-count").textContent = meta.coded_segment_count ?? "—";
  const d = meta.build ? new Date(meta.build).toLocaleDateString() : "—";
  document.getElementById("build-time").textContent = d;
}

async function renderPositionality() {
  const res = await fetch("public/positionality.md" + CACHE_BUST);
  const el = document.getElementById("positionality-body");
  if (!el) return;
  if (!res.ok) {
    el.innerHTML = "<p>Positionality statement not yet built into <code>public/</code>. Run <code>make publish</code>.</p>";
    return;
  }
  const md = await res.text();
  el.innerHTML = mdToHTML(md);
}

async function renderThreeCodes() {
  // Three-codes now pulls from quote_allocation.json (the bank) not from
  // raw coded_segments. Each pick is a clean, verified, deduped quote.
  const alloc = await loadJSON("public/data/quote_allocation.json");
  const rowsEl = document.getElementById("three-codes-rows");
  if (!rowsEl) return;
  const picks = alloc?.three_codes || [];
  if (!picks.length) {
    rowsEl.innerHTML = `<div class="empty">quote bank not built yet — run <code>make stage09 stage10 stage05</code>.</div>`;
    return;
  }
  rowsEl.innerHTML = "";
  for (const pick of picks) {
    const div = document.createElement("div");
    div.className = "three-code-row";
    const sectionLabel = prettySection(pick.section_id);
    const deductive = pick._codes || [];
    const inductive = pick.llm_inductive_codes || [];
    const cleaned = pick.cleaned_text || pick.raw_text || "";
    div.innerHTML = `
      <div>
        <div class="utterance">${escape(cleaned)}</div>
        <div class="fg-id">from the ${sectionLabel} section</div>
      </div>
      <div class="codes">${codesHTML(deductive, "llm")}</div>
      <div class="codes">${codesHTML(inductive, "invivo")}</div>
      <div class="codes codes-pending"><span class="code-chip" style="opacity:.4">pending</span></div>
    `;
    rowsEl.appendChild(div);
  }
}

function prettySection(sid) {
  return ({
    s1_welcome: "welcome",
    s2_warmup_goaround: "warm-up go-around",
    s3_warmup_reaction: "group reaction",
    s4_two_sided_risk: "two-sided risk vote",
    s5_professional_readiness: "professional readiness",
    s6_pair_share: "pair share",
    s7_dot_voting_close: "dot voting + close",
  }[sid] || sid || "");
}

function codesHTML(codes, cls) {
  if (!codes || !codes.length) return `<span class="code-chip" style="opacity:.4">—</span>`;
  return codes.map((c) => `<span class="code-chip ${cls}">${escape(c)}</span>`).join("");
}

async function renderDisagreements() {
  const rows = await loadJSON("public/data/disagreements.json");
  const el = document.getElementById("disagreements-list");
  if (!rows || !rows.length) return;
  el.innerHTML = "";
  for (const r of rows.slice(0, 20)) {
    const div = document.createElement("div");
    div.className = "disagreement";
    div.innerHTML = `
      ${contextBlockHTML(r.context, r.text)}
      <div class="diff-row"><span class="diff-label">LM</span>    <span>${r.lm_codes.join(", ") || "—"}</span></div>
      <div class="diff-row"><span class="diff-label">Claude</span> <span>${r.llm_codes.join(", ") || "—"}</span></div>
      <div class="diff-row"><span class="diff-label">only LM</span><span>${r.only_lm.join(", ") || "—"}</span></div>
      <div class="diff-row"><span class="diff-label">only Claude</span><span>${r.only_llm.join(", ") || "—"}</span></div>
    `;
    el.appendChild(div);
    attachReactionBar(div, "disagreement", `${r.fg_id}:${r.line_id}`);
  }
}

/**
 * Render a context window around a coded utterance as a long block quote.
 * Consecutive lines from the same speaker are merged into one paragraph —
 * so a multi-line student thought reads as one continuous block, not a
 * staccato of STU labels. The center line (the actual coded utterance)
 * stays highlighted within its merged paragraph.
 */
function contextBlockHTML(context, fallbackText) {
  if (!context || !context.center) {
    return `<blockquote class="ctx-quote"><p class="ctx-para"><span class="ctx-center">${escape(fallbackText || "")}</span></p></blockquote>`;
  }
  const all = [
    ...(context.before || []).map((l) => ({ ...l, role: "before" })),
    { ...context.center, role: "center" },
    ...(context.after || []).map((l) => ({ ...l, role: "after" })),
  ];

  // Group adjacent lines by speaker
  const groups = [];
  for (const line of all) {
    const last = groups[groups.length - 1];
    if (last && last.speaker === line.speaker) {
      last.lines.push(line);
    } else {
      groups.push({ speaker: line.speaker, lines: [line] });
    }
  }

  const paras = groups.map((g) => {
    const speakerLabel = g.speaker === "MOD" ? "MOD" : "STU";
    // Merge line texts into one continuous paragraph. If any line is the
    // center, wrap that line's text (only) in a .ctx-center span.
    const merged = g.lines.map((l) => {
      const text = escape(l.text);
      if (l.role === "center") return `<span class="ctx-center">${text}</span>`;
      return text;
    }).join(" ");
    const cls = g.lines.some((l) => l.role === "center") ? "ctx-para ctx-para-center" : "ctx-para";
    return `<p class="${cls}"><span class="ctx-speaker">${speakerLabel}</span>${merged}</p>`;
  }).join("");

  return `<blockquote class="ctx-quote">${paras}</blockquote>`;
}

async function renderAiSlop() {
  const d = await loadJSON("public/data/ai_slop.json");
  const alloc = await loadJSON("public/data/quote_allocation.json");
  const codebook = await loadJSON("public/data/codebook.json");
  if (!d) return;
  const rig = document.getElementById("slop-rigorous");
  const slp = document.getElementById("slop-slop");

  // --- SLOP side (left) ---
  const sThemes = d.slop?.themes || [];
  if (sThemes.length) {
    slp.innerHTML = sThemes.map((t) => `
      <div class="slop-theme slop-theme-slop">
        <h4 class="slop-theme-name">${escape(t.name || t.theme || "")}</h4>
        <div class="slop-theme-def">${escape(t.description || t.summary || "")}</div>
        ${t.evidence ? `<blockquote class="slop-quote">"${escape(t.evidence)}"</blockquote>` : ""}
      </div>
    `).join("");
  } else {
    slp.innerHTML = `<div class="empty">run <code>make stage06</code> to generate</div>`;
  }

  // --- BETTER side (right) — pulled from allocator, NOT from coded_segments ---
  // Each rigorous item shows: code id, definition, vivid quote from bank.
  // This gives visual weight parity with the slop column.
  const rigorousQuotes = alloc?.ai_slop_rigorous || [];
  const defs = {};
  if (codebook && codebook.codes) {
    for (const c of codebook.codes) defs[c.id] = c;
  }

  if (rigorousQuotes.length) {
    rig.innerHTML = rigorousQuotes.map((q) => {
      // Attach the most relevant code from _codes as the theme anchor
      const primaryCode = (q._codes && q._codes[0]) || "";
      const def = defs[primaryCode] || {};
      return `
        <div class="slop-theme slop-theme-rigorous">
          <h4 class="slop-theme-name"><code class="slop-code-id">${escape(primaryCode)}</code></h4>
          <div class="slop-theme-def">${escape(def.definition || "")}</div>
          <blockquote class="slop-quote">${escape(q.cleaned_text || "")}</blockquote>
          <cite class="slop-cite">from the ${prettySection(q.section_id)} section</cite>
        </div>
      `;
    }).join("");
  } else {
    // Fallback to the old ai_slop.json shape
    const rThemes = d.rigorous?.themes || [];
    if (rThemes.length) {
      rig.innerHTML = rThemes.map((t) => `
        <div class="slop-theme slop-theme-rigorous">
          <h4 class="slop-theme-name"><code class="slop-code-id">${escape(t.code)}</code></h4>
          <div class="slop-theme-def">${escape(t.definition || "")}</div>
          ${(t.quotes || []).slice(0, 1).map((q) =>
            `<blockquote class="slop-quote">${escape(q.quote || "")}</blockquote>
             <cite class="slop-cite">from the ${prettySection(q.section_id)} section</cite>`
          ).join("")}
        </div>
      `).join("");
    } else {
      rig.innerHTML = `<div class="empty">quote bank not built yet — run <code>make stage09 stage10</code></div>`;
    }
  }
}

async function renderFieldNotes() {
  // Prefer the new pairings view; fall back to nothing if stage_01e hasn't run
  const pairings = await loadJSON("public/data/field_pairings.json");
  const el = document.getElementById("field-pairings");
  if (!el) return;
  if (!pairings || !Object.keys(pairings).length) {
    el.innerHTML = `<div class="empty">pairings not generated yet — run <code>make stage01e</code></div>`;
    return;
  }
  // Flatten to a single list; shuffle by FG so consecutive cards aren't from the same room
  const all = [];
  for (const [fgId, pairs] of Object.entries(pairings)) {
    for (const p of pairs) all.push({ ...p, _fg: fgId });
  }
  if (!all.length) {
    el.innerHTML = `<div class="empty">no pairings yet.</div>`;
    return;
  }
  // Interleave across FGs so reading feels varied
  const byFg = new Map();
  for (const p of all) {
    if (!byFg.has(p._fg)) byFg.set(p._fg, []);
    byFg.get(p._fg).push(p);
  }
  const interleaved = [];
  while (interleaved.length < all.length) {
    let any = false;
    for (const list of byFg.values()) {
      if (list.length) { interleaved.push(list.shift()); any = true; }
    }
    if (!any) break;
  }

  el.innerHTML = "";
  for (const p of interleaved) {
    const card = document.createElement("div");
    card.className = `field-pair affect-${p.affect || "other"}`;

    // Collapse transcript lines into one reading paragraph, merging same-speaker
    const lines = p.transcript_lines || [];
    const groups = [];
    for (const line of lines) {
      const last = groups[groups.length - 1];
      if (last && last.speaker === line.speaker) last.lines.push(line);
      else groups.push({ speaker: line.speaker, lines: [line] });
    }
    const transcriptHTML = groups.map((g) => {
      const speakerLabel = g.speaker === "MOD" ? "MOD" : "STU";
      const merged = g.lines.map((l) => escape(l.text)).join(" ");
      return `<p class="fp-para"><span class="ctx-speaker">${speakerLabel}</span>${merged}</p>`;
    }).join("");

    card.innerHTML = `
      <div class="fp-label">${escape(p.label || "")}</div>
      <div class="fp-observation">${escape(p.observation || "")}</div>
      <div class="fp-divider"><span>the moment in the transcript</span></div>
      <blockquote class="fp-transcript">${transcriptHTML}</blockquote>
      <div class="fp-meta">
        <span class="affect-pill affect-pill-${p.affect || "other"}">${escape(p.affect || "")}</span>
        <span class="fp-section">from the ${prettySection(p.section_id)} section</span>
      </div>
    `;
    el.appendChild(card);
  }
}

async function renderThemes() {
  // Themes now render from the quote_allocation.json bank, not from raw
  // coded_segments, so every quote is cleaned and dedupe-guaranteed.
  const alloc = await loadJSON("public/data/quote_allocation.json");
  const el = document.getElementById("themes-list");
  if (!alloc || !alloc.themes || !Object.keys(alloc.themes).length) {
    // Fallback: show the old themes.json if the bank isn't built yet
    const themes = await loadJSON("public/data/themes.json");
    if (!themes || !themes.length) return;
    el.innerHTML = `<div class="empty">quote bank not built yet — run <code>make stage09 stage10 stage05</code>.</div>`;
    return;
  }

  // Order themes by the allocator's top_codes ranking
  const order = alloc.top_codes || Object.keys(alloc.themes);
  // Use codebook.json for pretty definitions
  const codebook = await loadJSON("public/data/codebook.json");
  const defs = {};
  if (codebook && codebook.codes) {
    for (const c of codebook.codes) defs[c.id] = c;
  }

  el.innerHTML = "";
  for (const code of order) {
    const group = alloc.themes[code];
    if (!group) continue;
    const def = defs[code] || {};
    const card = document.createElement("div");
    card.className = "theme-card";
    card.innerHTML = `
      <h3>${escape(code)}</h3>
      <div class="theme-def">${escape(def.definition || "")}</div>
      <div class="theme-examples"></div>
      <details class="theme-more">
        <summary><span class="theme-more-open">show ${(group.more || []).length} more</span><span class="theme-more-close">hide</span></summary>
        <div class="theme-more-list"></div>
      </details>
    `;
    const examples = card.querySelector(".theme-examples");
    for (const q of group.visible || []) {
      examples.appendChild(renderBankQuote(q));
    }
    const moreList = card.querySelector(".theme-more-list");
    for (const q of group.more || []) {
      moreList.appendChild(renderBankQuote(q));
    }
    if (!(group.more || []).length) {
      card.querySelector(".theme-more").remove();
    }
    el.appendChild(card);
  }
}

function renderBankQuote(q) {
  const e = document.createElement("div");
  e.className = "theme-example";
  const cleaned = q.cleaned_text || q.raw_text || "";
  e.innerHTML = `
    <blockquote class="bank-quote">${escape(cleaned)}</blockquote>
    <cite>from the ${prettySection(q.section_id)} section</cite>
  `;
  attachReactionBar(e, "quote", q.id);
  return e;
}

async function renderExchanges() {
  const data = await loadJSON("public/data/exchanges.json");
  const el = document.getElementById("exchanges-list");
  if (!el) return;
  if (!data || !data.length) return;

  el.innerHTML = "";
  for (const ex of data) {
    const card = document.createElement("details");
    card.className = "exchange-card";
    card.open = false;

    const sectionLabel = prettySection(ex.section_id);
    const turnCount = (ex.turns || []).length;
    const summaryHTML = `
      <summary class="exchange-summary">
        <span class="exchange-label">${escape(ex.label)}</span>
        <span class="exchange-meta">${sectionLabel} · ${turnCount} turns</span>
      </summary>
    `;

    const turnsHTML = (ex.turns || []).map((t) => {
      const speaker = t.speaker || "STU";
      const speakerClass = speaker === "MOD" ? "ex-speaker-mod" : "ex-speaker-stu";
      const speakerLabel = speaker === "MOD" ? "MOD" : speaker;
      return `
        <div class="exchange-turn ${speakerClass}">
          <span class="exchange-speaker">${escape(speakerLabel)}</span>
          <div class="exchange-text">${escape(t.text)}</div>
        </div>
      `;
    }).join("");

    card.innerHTML = `${summaryHTML}<div class="exchange-body">${turnsHTML}</div>`;
    el.appendChild(card);
  }
}

async function renderMoreVoices() {
  const alloc = await loadJSON("public/data/quote_allocation.json");
  const listEl = document.getElementById("more-voices-list");
  const filtersEl = document.getElementById("more-voices-filters");
  if (!listEl) return;
  const unused = alloc?.unused || [];
  if (!unused.length) {
    listEl.innerHTML = `<div class="empty">no unused quotes in the bank.</div>`;
    return;
  }

  // Group by section to allow filter-chip browsing
  const sections = [
    "s2_warmup_goaround",
    "s3_warmup_reaction",
    "s4_two_sided_risk",
    "s5_professional_readiness",
    "s6_pair_share",
    "s7_dot_voting_close",
  ];
  const byMySection = new Map();
  for (const q of unused) {
    const sid = q.section_id || "other";
    if (!byMySection.has(sid)) byMySection.set(sid, []);
    byMySection.get(sid).push(q);
  }

  // Build filter chips
  const chips = [`<button class="mv-chip active" data-sec="all">all (${unused.length})</button>`];
  for (const sid of sections) {
    const n = (byMySection.get(sid) || []).length;
    if (n === 0) continue;
    chips.push(`<button class="mv-chip" data-sec="${sid}">${prettySection(sid)} (${n})</button>`);
  }
  filtersEl.innerHTML = chips.join("");

  // Render all initially, hide on filter change
  const render = (filterSec) => {
    listEl.innerHTML = "";
    const quotes = filterSec === "all" ? unused : (byMySection.get(filterSec) || []);
    // Sort by section then by length desc within section
    const ordered = [...quotes].sort((a, b) => {
      const as = sections.indexOf(a.section_id || "");
      const bs = sections.indexOf(b.section_id || "");
      if (as !== bs) return as - bs;
      return (b.cleaned_text || "").length - (a.cleaned_text || "").length;
    });
    for (const q of ordered) {
      const card = document.createElement("div");
      card.className = "mv-card";
      card.innerHTML = `
        <blockquote>${escape(q.cleaned_text || q.raw_text || "")}</blockquote>
        <cite>from the ${prettySection(q.section_id)} section</cite>
      `;
      listEl.appendChild(card);
      attachReactionBar(card, "quote", q.id);
    }
  };
  render("all");

  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".mv-chip");
    if (!btn) return;
    filtersEl.querySelectorAll(".mv-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    render(btn.dataset.sec);
  });
}

async function renderVotes() {
  const votes = await loadJSON("public/data/vote_tallies.json");
  const el = document.getElementById("votes-body");
  if (!votes) return;

  const two = votes.two_sided_risk || {};
  const total = (two.overuse || 0) + (two.underuse || 0) + (two.ambivalent || 0);
  const agg = (votes.pair_share_dots && votes.pair_share_dots.items_aggregated) || [];

  if (total === 0 && agg.length === 0) {
    el.innerHTML = `<div class="empty">vote tallies not entered yet.<br>edit <code>data/derived/vote_tallies.json</code> and run <code>make publish</code>.</div>`;
    return;
  }

  el.innerHTML = "";

  // --- Two-sided risk: split chart ---
  if (total > 0) {
    const overPct = Math.round((two.overuse || 0) / total * 100);
    const underPct = Math.round((two.underuse || 0) / total * 100);
    const ambPct = 100 - overPct - underPct;
    const fgCount = two.fg_votes_recorded || 0;

    const split = document.createElement("div");
    split.className = "vote-split";
    split.innerHTML = `
      <h3 class="vote-head">concern 1 vs concern 2</h3>
      <p class="vote-caption">aggregated across ${fgCount} focus group${fgCount === 1 ? "" : "s"} · ${total} votes total</p>
      <div class="split-bar">
        <div class="split-seg seg-overuse"   style="width:${overPct}%"  title="concern 1: overuse (${two.overuse})">
          <span class="split-label">overuse</span>
          <span class="split-count">${two.overuse || 0}</span>
        </div>
        <div class="split-seg seg-ambivalent" style="width:${ambPct}%"  title="ambivalent (${two.ambivalent})">
          ${ambPct > 4 ? `<span class="split-label">ambivalent</span><span class="split-count">${two.ambivalent || 0}</span>` : ""}
        </div>
        <div class="split-seg seg-underuse"  style="width:${underPct}%" title="concern 2: underuse (${two.underuse})">
          <span class="split-label">underuse</span>
          <span class="split-count">${two.underuse || 0}</span>
        </div>
      </div>
      <div class="split-legend">
        <div><strong>concern 1:</strong> using AI too heavily is a cost to learning, writing, independent thinking</div>
        <div><strong>concern 2:</strong> not using AI well/enough leaves you less prepared than peers</div>
      </div>
    `;
    el.appendChild(split);

    // Per-FG breakdown: small stacked horizontal bars
    if (two.by_fg && Object.keys(two.by_fg).length) {
      const fgWrap = document.createElement("div");
      fgWrap.className = "vote-per-fg";
      fgWrap.innerHTML = `<h4 class="vote-subhead">by focus group</h4>`;
      const allFgKeys = Object.keys(two.by_fg).sort();
      const entries = Object.entries(two.by_fg).sort();
      for (const [fgId, row] of entries) {
        const t = (row.overuse || 0) + (row.underuse || 0) + (row.ambivalent || 0);
        if (t === 0) continue;
        const letter = "ABCDEFGHIJK"[allFgKeys.indexOf(fgId)] || "?";
        const note = row.note || "";
        const labelAttr = note ? ` title="${escape(note)}" style="cursor:help;border-bottom:1px dotted var(--rule);"` : "";
        const row_html = `
          <div class="vote-fg-row">
            <span class="vote-fg-label"${labelAttr}>focus group ${letter}</span>
            <div class="split-bar">
              <div class="split-seg seg-overuse" style="width:${(row.overuse || 0) / t * 100}%"></div>
              <div class="split-seg seg-ambivalent" style="width:${(row.ambivalent || 0) / t * 100}%"></div>
              <div class="split-seg seg-underuse" style="width:${(row.underuse || 0) / t * 100}%"></div>
            </div>
            <span class="vote-fg-total">${t}</span>
          </div>
        `;
        fgWrap.insertAdjacentHTML("beforeend", row_html);
      }
      el.appendChild(fgWrap);
    }
  }

  // --- Pair-share dots: collapsed categories with hover sub-items ---
  const collapsed = votes.collapsed_categories || [];
  if (collapsed.length) {
    const h = document.createElement("h3");
    h.className = "vote-head";
    h.style.marginTop = "2.5rem";
    h.textContent = "what HKS should provide (pair-share dot votes)";
    el.appendChild(h);
    const caption = document.createElement("p");
    caption.className = "vote-caption";
    caption.textContent = `9 categories collapsed from 65 items across 11 posters · hover for sub-items`;
    el.appendChild(caption);

    const max = Math.max(...collapsed.map((d) => d.dots));
    for (const d of collapsed) {
      const row = document.createElement("div");
      row.className = "vote-bar vote-bar--has-tooltip";
      const pct = (d.dots / max) * 100;
      const subs = (d.sub_items || [])
        .map((s) => `<span class="tt-row"><span class="tt-item">${escape(s.item)}</span><span class="tt-dots">${s.dots}</span></span>`)
        .join("");
      row.innerHTML = `
        <span class="label">${escape(d.category)}</span>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="count">${d.dots}</span>
        ${subs ? `<div class="vote-tooltip">${subs}</div>` : ""}
      `;
      el.appendChild(row);
    }
  } else if (agg.length) {
    // Fallback to raw aggregation if no collapsed categories
    const h = document.createElement("h3");
    h.className = "vote-head";
    h.style.marginTop = "2.5rem";
    h.textContent = "what HKS should provide (pair-share dot votes)";
    el.appendChild(h);
    const caption = document.createElement("p");
    caption.className = "vote-caption";
    caption.textContent = `aggregated across focus groups · top items by total dots`;
    el.appendChild(caption);

    const max = Math.max(...agg.map((d) => d.count));
    for (const d of agg) {
      const row = document.createElement("div");
      row.className = "vote-bar";
      const pct = (d.count / max) * 100;
      row.innerHTML = `
        <span class="label">${escape(d.item)}</span>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <span class="count">${d.count}</span>
      `;
      el.appendChild(row);
    }
  }
}

// =====================================================================
// Auth + profile
// =====================================================================

async function initAuth() {
  const slot = document.getElementById("auth-slot");
  const signinBtn = document.getElementById("signin-btn");

  if (!supabase) {
    // Hide the sign-in button entirely until a backend is configured — a
    // disabled button invites confused clicking. Comments section carries
    // the full explanation.
    slot.innerHTML = "";
    return;
  }

  // Handle magic-link callback
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await onSignedIn(session);

  supabase.auth.onAuthStateChange(async (_event, session) => {
    if (session) await onSignedIn(session);
    else renderSignedOut();
  });

  signinBtn.addEventListener("click", () => document.getElementById("auth-dialog").showModal());

  document.getElementById("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: cfg.SITE_URL },
    });
    const errEl = document.getElementById("auth-error");
    if (error) { errEl.textContent = error.message; return; }
    errEl.textContent = "check your inbox — link sent.";
    setTimeout(() => document.getElementById("auth-dialog").close(), 1500);
  });
}

async function onSignedIn(session) {
  // Ensure profile exists
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
  if (!profile) {
    // Show profile setup
    const dlg = document.getElementById("profile-dialog");
    dlg.showModal();
    document.getElementById("profile-form").onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const emailDomain = (session.user.email || "").split("@")[1] || "";
      const { error } = await supabase.from("profiles").insert({
        id: session.user.id,
        role: fd.get("role"),
        program: fd.get("program") || null,
        grad_year: fd.get("grad_year") ? Number(fd.get("grad_year")) : null,
        display_name: fd.get("display_name") || null,
        email_domain: emailDomain,
      });
      if (!error) { dlg.close(); renderSignedIn(session); }
      else alert(error.message);
    };
    return;
  }
  renderSignedIn(session);
}

function renderSignedIn(session) {
  const slot = document.getElementById("auth-slot");
  slot.innerHTML = `<button class="btn btn-ghost" id="signout-btn">sign out</button>`;
  document.getElementById("signout-btn").onclick = () => supabase.auth.signOut();
  loadAllReactions();
  loadReadershipMix();
  subscribeToRealtime();
}

function renderSignedOut() {
  const slot = document.getElementById("auth-slot");
  slot.innerHTML = `<button class="btn btn-ghost" id="signin-btn">sign in</button>`;
  document.getElementById("signin-btn").addEventListener("click", () => document.getElementById("auth-dialog").showModal());
}

// =====================================================================
// Reactions (live)
// =====================================================================

const reactionBars = new Map();  // "target_type:target_id" -> DOM element

function attachReactionBar(containerEl, targetType, targetId) {
  const bar = document.createElement("div");
  bar.className = "reaction-bar";
  bar.dataset.targetType = targetType;
  bar.dataset.targetId = targetId;
  for (const r of REACTION_EMOJIS) {
    const btn = document.createElement("button");
    btn.className = "reaction-btn";
    btn.dataset.emoji = r.key;
    btn.innerHTML = `${r.char} <span class="count">0</span>`;
    btn.addEventListener("click", () => toggleReaction(targetType, targetId, r.key, btn));
    bar.appendChild(btn);
  }
  containerEl.appendChild(bar);
  reactionBars.set(`${targetType}:${targetId}`, bar);
}

// Initialize any static reaction-bar placeholders
function initStaticReactionBars() {
  document.querySelectorAll(".reaction-bar[data-target-type]").forEach((el) => {
    const targetType = el.dataset.targetType;
    const targetId = el.dataset.targetId;
    el.innerHTML = "";
    for (const r of REACTION_EMOJIS) {
      const btn = document.createElement("button");
      btn.className = "reaction-btn";
      btn.dataset.emoji = r.key;
      btn.innerHTML = `${r.char} <span class="count">0</span>`;
      btn.addEventListener("click", () => toggleReaction(targetType, targetId, r.key, btn));
      el.appendChild(btn);
    }
    reactionBars.set(`${targetType}:${targetId}`, el);
  });
}

async function loadAllReactions() {
  if (!supabase) return;
  // Clear any stale .active marks first, then repaint from server state.
  document.querySelectorAll(".reaction-btn.active").forEach((b) => b.classList.remove("active"));
  const { data: counts } = await supabase.from("v_reaction_counts").select("*");
  if (counts) for (const row of counts) applyReactionCount(row);
  // Mark the user's own reactions active — multi-emoji per target is allowed.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const { data: mine } = await supabase.from("reactions")
    .select("target_type, target_id, emoji")
    .eq("user_id", session.user.id);
  if (!mine) return;
  for (const r of mine) {
    const bar = reactionBars.get(`${r.target_type}:${r.target_id}`);
    if (!bar) continue;
    const btn = bar.querySelector(`[data-emoji="${r.emoji}"]`);
    if (btn) btn.classList.add("active");
  }
}

function applyReactionCount({ target_type, target_id, emoji, n }) {
  const bar = reactionBars.get(`${target_type}:${target_id}`);
  if (!bar) return;
  const btn = bar.querySelector(`[data-emoji="${emoji}"]`);
  if (!btn) return;
  btn.querySelector(".count").textContent = n;
}

async function toggleReaction(target_type, target_id, emoji, btn) {
  if (!supabase) { alert("sign in to react"); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { document.getElementById("auth-dialog").showModal(); return; }

  btn.classList.toggle("active");
  if (btn.classList.contains("active")) {
    await supabase.from("reactions").insert({ user_id: session.user.id, target_type, target_id, emoji });
  } else {
    await supabase.from("reactions").delete()
      .eq("user_id", session.user.id).eq("target_type", target_type).eq("target_id", target_id).eq("emoji", emoji);
  }
  // Server-side aggregate will refresh via realtime subscription.
}

function subscribeToRealtime() {
  if (!supabase) return;
  supabase.channel("reactions-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "reactions" }, () => loadAllReactions())
    .subscribe();
  supabase.channel("comments-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "comments" }, () => loadSiteComments())
    .subscribe();
}

// =====================================================================
// Comments (site-wide bucket for now)
// =====================================================================

async function initComments() {
  const stateEl = document.getElementById("comments-state");
  const root = document.getElementById("site-comments");

  // CASE 1: Supabase not yet configured — comment form is disabled and we
  // say exactly what's going on + where comments will be posted once it's
  // live, so a reader isn't confused about whether their text is being saved.
  if (!supabase) {
    stateEl.innerHTML = `
      <div class="comments-disabled-card">
        <div class="comments-disabled-label">comments are not yet live</div>
        <p>
          This section will accept reactions and short written responses from
          anyone with a Harvard email. Until the backend is connected, nothing
          typed here gets saved anywhere — the form is hidden on purpose so no
          one assumes their comment was posted.
        </p>
        <p class="comments-plan">
          <strong>When it goes live:</strong> sign-in uses a one-time email link
          (no password), and your comment is attributed to your role (student /
          staff / faculty) and program if applicable — not your name, unless
          you opt in. Everything you post is <strong>visible to everyone else
          signed in with a Harvard email</strong>. It is not a private message.
          It is not anonymous to Prof. McKenna.
        </p>
      </div>
    `;
    root.hidden = true;
    return;
  }

  // CASE 2: Supabase IS configured — render the real form with the same
  // privacy notice so readers know where their comment goes.
  stateEl.innerHTML = `
    <div class="comments-notice">
      <strong>Where your comment goes:</strong> everything you post is
      visible to everyone else signed in with a Harvard email. Your
      role and program are shown next to your comment; your name is
      not shown unless you opted in on your profile. This is not a
      private message, and it is not anonymous to Prof. McKenna.
    </div>
  `;
  root.hidden = false;
  root.innerHTML = `
    <form class="comment-form" id="comment-form">
      <textarea name="body" placeholder="say something back..." required></textarea>
      <button type="submit" class="btn-primary" style="font-family:var(--font-body);padding:0.6rem 1.1rem;">post</button>
    </form>
    <div class="comment-list" id="comment-list"></div>
  `;
  document.getElementById("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { document.getElementById("auth-dialog").showModal(); return; }
    const body = e.target.body.value.trim();
    if (!body) return;
    await supabase.from("comments").insert({
      user_id: session.user.id, target_type: "section", target_id: "site-wide", body,
    });
    e.target.reset();
    loadSiteComments();
  });
  loadSiteComments();
}

async function loadSiteComments() {
  if (!supabase) return;
  const { data } = await supabase.from("v_comments_public").select("*")
    .eq("target_type", "section").eq("target_id", "site-wide")
    .order("created_at", { ascending: false }).limit(50);
  const list = document.getElementById("comment-list");
  if (!list) return;
  if (!data || !data.length) {
    list.innerHTML = `<div class="empty">no comments yet — be first.</div>`;
    return;
  }
  list.innerHTML = data.map((c) => `
    <div class="comment">
      <div class="comment-meta">${escape(c.display_name)} · ${c.program || c.role} · ${new Date(c.created_at).toLocaleDateString()}</div>
      <div class="comment-body">${escape(c.body)}</div>
    </div>
  `).join("");
}

// =====================================================================
// Readership mix (aggregate)
// =====================================================================

async function loadReadershipMix() {
  // Panel removed — left as a no-op so callers don't break.
}

// =====================================================================
// Utilities
// =====================================================================

function escape(s) {
  if (s == null) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// =====================================================================
// Boot
// =====================================================================

(async function boot() {
  await renderMeta();
  await renderMemo();
  await renderPositionality();
  await renderFieldNotes();
  await renderVotes();
  await initExecEmojiBars();
})();

// =====================================================================
// Executive-summary emoji bars
// One emoji per finding per visitor (enforced via localStorage).
// Counts are local-only until a Supabase project is configured; once
// SUPABASE_URL is set in config.js, reactions write to the `reactions`
// table and counts read from `v_reaction_counts`.
// =====================================================================
const EXEC_EMOJI = [
  { key: "up",     char: "👍" },
  { key: "down",   char: "👎" },
  { key: "yes",    char: "💯" },
  { key: "think",  char: "🤔" },
  { key: "ouch",   char: "😬" },
  { key: "heart",  char: "❤️" },
  { key: "fire",   char: "🔥" },
];

function getVisitorId() {
  let v = localStorage.getItem("visitor-id");
  if (!v) {
    v = (crypto.randomUUID && crypto.randomUUID()) ||
        ("v_" + Math.random().toString(36).slice(2) + Date.now());
    localStorage.setItem("visitor-id", v);
  }
  return v;
}

async function fetchExecCounts() {
  if (!supabase) return null;
  const { data, error } = await supabase.from("v_exec_reaction_counts").select("*");
  if (error) { console.warn("exec counts fetch failed:", error); return null; }
  return data;
}

async function writeExecReaction(targetId, emojiKey) {
  if (!supabase) return;
  const visitorId = getVisitorId();
  await supabase.from("exec_reactions")
    .delete().eq("visitor_id", visitorId).eq("target_id", targetId);
  if (emojiKey) {
    const { error } = await supabase.from("exec_reactions").insert({
      visitor_id: visitorId, target_id: targetId, emoji_key: emojiKey,
    });
    if (error) console.warn("exec reaction insert failed:", error);
  }
}

async function initExecEmojiBars() {
  const bars = document.querySelectorAll(".emoji-bar");
  if (!bars.length) return;
  const storeKey = "exec-emoji-pick";
  const picks = JSON.parse(localStorage.getItem(storeKey) || "{}");

  // Initial render with zero counts
  bars.forEach((bar) => {
    const target = bar.dataset.target;
    bar.innerHTML = EXEC_EMOJI.map((e) => `
      <button type="button" class="emoji-btn ${picks[target] === e.key ? "is-picked" : ""}"
              data-key="${e.key}" aria-label="React with ${e.key}">
        <span class="emoji-char">${e.char}</span>
        <span class="emoji-count" data-count="0">0</span>
      </button>
    `).join("");

    bar.addEventListener("click", async (ev) => {
      const btn = ev.target.closest(".emoji-btn");
      if (!btn) return;
      const key = btn.dataset.key;
      const prev = picks[target];

      if (prev === key) {
        delete picks[target];
        bar.querySelectorAll(".emoji-btn").forEach((b) => b.classList.remove("is-picked"));
        adjustCount(bar, key, -1);
        await writeExecReaction(target, null);
      } else {
        if (prev) {
          const oldBtn = bar.querySelector(`.emoji-btn[data-key="${prev}"]`);
          if (oldBtn) {
            oldBtn.classList.remove("is-picked");
            adjustCount(bar, prev, -1);
          }
        }
        picks[target] = key;
        bar.querySelectorAll(".emoji-btn").forEach((b) =>
          b.classList.toggle("is-picked", b.dataset.key === key));
        adjustCount(bar, key, +1);
        await writeExecReaction(target, key);
      }
      localStorage.setItem(storeKey, JSON.stringify(picks));
    });
  });

  // Hydrate from Supabase aggregate view; fall back to local-only if no supabase.
  const counts = await fetchExecCounts();
  if (counts) {
    // Replay any local picks that never made it to Supabase (e.g. clicks
    // from before the backend was wired, or from a page load where the
    // network request failed). writeExecReaction is idempotent.
    const localTargets = Object.keys(picks);
    if (localTargets.length) {
      await Promise.all(localTargets.map((t) => writeExecReaction(t, picks[t])));
      // Re-fetch so the catch-up writes show up immediately.
      const updated = await fetchExecCounts();
      if (updated) counts.splice(0, counts.length, ...updated);
    }
    const byTarget = {};
    for (const r of counts) {
      (byTarget[r.target_id] ||= {})[r.emoji_key] = r.n;
    }
    bars.forEach((bar) => {
      const target = bar.dataset.target;
      const ts = byTarget[target] || {};
      bar.querySelectorAll(".emoji-btn").forEach((btn) => {
        const k = btn.dataset.key;
        const el = btn.querySelector(".emoji-count");
        const n = ts[k] || 0;
        el.dataset.count = n;
        el.textContent = n;
      });
    });
  } else {
    // Local-only mode: reflect the visitor's own pick in the count.
    bars.forEach((bar) => {
      const target = bar.dataset.target;
      if (picks[target]) adjustCount(bar, picks[target], +1);
    });
  }
}

function adjustCount(bar, key, delta) {
  const el = bar.querySelector(`.emoji-btn[data-key="${key}"] .emoji-count`);
  if (!el) return;
  const n = (parseInt(el.dataset.count, 10) || 0) + delta;
  el.dataset.count = n;
  el.textContent = n;
}
