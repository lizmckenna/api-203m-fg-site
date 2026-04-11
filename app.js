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
  if (introEl) introEl.innerHTML = mdToHTML(intro);
  if (restEl)  restEl.innerHTML  = mdToHTML(rest);
}

// Walk the memo markdown line-by-line. Keep: the H1, the first H2, and the
// first 2 body paragraphs under it (pull-quote paragraphs count). The rest
// becomes the collapsed body.
function splitMemo(md) {
  const lines = md.split("\n");
  const intro = [];
  const rest = [];
  let phase = "pre";   // pre = before first H2, first_h2 = collecting intro paras, rest
  let paraCount = 0;
  let inPara = false;

  for (const raw of lines) {
    if (phase === "pre") {
      intro.push(raw);
      if (raw.startsWith("## ")) {
        phase = "first_h2";
      }
      continue;
    }
    if (phase === "first_h2") {
      // Blank line → paragraph boundary
      if (raw === "") {
        if (inPara) {
          paraCount++;
          inPara = false;
          if (paraCount >= 2) {
            intro.push(raw);
            phase = "rest";
            continue;
          }
        }
        intro.push(raw);
        continue;
      }
      // Paragraph content
      intro.push(raw);
      inPara = true;
      continue;
    }
    rest.push(raw);
  }
  return { intro: intro.join("\n"), rest: rest.join("\n") };
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
  const seg = await loadJSONL("public/data/coded_segments.jsonl");
  const el = document.getElementById("three-codes-table");
  if (!seg.length) return;

  // Keep only substantive student utterances with actual codes applied —
  // no moderator script, no one-word fragments, no empty-codes rows.
  const substantive = seg.filter((s) =>
    s.speaker === "STU" &&
    Array.isArray(s.codes) && s.codes.length > 0 &&
    (s.text || "").length >= 60 &&
    s.confidence !== "low"
  );

  // Group by (fg_id, line_id) so each row shows all coders for the same utterance
  const grouped = new Map();
  for (const s of substantive) {
    const key = `${s.fg_id}:${s.line_id}`;
    if (!grouped.has(key)) grouped.set(key, { fg_id: s.fg_id, line_id: s.line_id, text: s.text, section_id: s.section_id, coders: {} });
    grouped.get(key).coders[s.coder] = s;
  }

  // Diversify by code — don't show 25 rows that are all "use.academic".
  // Round-robin across codes: pick the first one from each code, then the
  // second, etc. until we have 20.
  const byCode = new Map();
  for (const row of grouped.values()) {
    const llm = row.coders["llm-claude"];
    if (!llm) continue;
    for (const code of llm.codes) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(row);
    }
  }
  const picks = [];
  const used = new Set();
  let added = true;
  while (added && picks.length < 20) {
    added = false;
    for (const [code, rows] of byCode) {
      const row = rows.find((r) => !used.has(`${r.fg_id}:${r.line_id}`));
      if (row) {
        used.add(`${row.fg_id}:${row.line_id}`);
        picks.push(row);
        added = true;
        if (picks.length >= 20) break;
      }
    }
  }

  el.innerHTML = "";
  for (const row of picks) {
    const div = document.createElement("div");
    div.className = "three-code-row";
    const lm = row.coders["LM"];
    const llm = row.coders["llm-claude"];
    const iv = row.coders["invivo"];
    // Build the utterance text — merge-paragraph-style (no line breaks).
    // The quote is already one line in the JSON; we render it as one <p>.
    const sectionLabel = prettySection(row.section_id);
    div.innerHTML = `
      <div>
        <div class="utterance">"${escape(row.text)}"</div>
        <div class="fg-id">${sectionLabel}</div>
      </div>
      <div class="codes">${codesHTML(lm?.codes, "lm")}</div>
      <div class="codes">${codesHTML(llm?.codes, "llm")}</div>
      <div class="codes">${codesHTML(iv?.codes, "invivo")}</div>
    `;
    el.appendChild(div);
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
  if (!d) return;
  const rig = document.getElementById("slop-rigorous");
  const slp = document.getElementById("slop-slop");

  const rThemes = d.rigorous?.themes || [];
  if (rThemes.length) {
    rig.innerHTML = rThemes.map((t) => `
      <div class="slop-theme">
        <div class="slop-theme-head">
          <code>${escape(t.code)}</code>
          <span class="slop-theme-count">${t.count}×</span>
        </div>
        <div class="slop-theme-def">${escape(t.definition || "")}</div>
        <div class="slop-theme-quotes">
          ${(t.quotes || []).slice(0, 2).map((q) =>
            `${contextBlockHTML(q.context, q.quote)}<cite>from the ${prettySection(q.section_id)} section</cite>`
          ).join("")}
        </div>
      </div>
    `).join("");
  } else {
    rig.innerHTML = `<div class="empty">no coded data yet — run <code>make stage02</code></div>`;
  }

  const sThemes = d.slop?.themes || [];
  if (sThemes.length) {
    slp.innerHTML = sThemes.map((t) => `
      <div class="slop-theme slop-theme-slop">
        <div class="slop-theme-head"><strong>${escape(t.name || t.theme || "")}</strong></div>
        <div class="slop-theme-def">${escape(t.description || t.summary || "")}</div>
        ${t.evidence ? `<blockquote>"${escape(t.evidence)}"</blockquote>` : ""}
      </div>
    `).join("");
  } else {
    slp.innerHTML = `<div class="empty">run <code>make stage06</code> to generate</div>`;
  }

  // Tiny caption showing which FG the comparison is drawn from and how the slop was produced
  const hdr = document.querySelector("#ai-slop .section-lede");
  if (hdr && d.fg_id) {
    hdr.insertAdjacentHTML("afterend",
      `<div class="slop-caption">drawn from <code>${escape(d.fg_id)}</code> · rigorous side from the deductive pass, slop side from a single unconstrained prompt: <em>"tell me what the main themes are"</em></div>`
    );
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
  const themes = await loadJSON("public/data/themes.json");
  const el = document.getElementById("themes-list");
  if (!themes || !themes.length) return;
  el.innerHTML = "";
  for (const t of themes) {
    const div = document.createElement("div");
    div.className = "theme-card";
    div.innerHTML = `
      <h3>${escape(t.code)}</h3>
      <div class="theme-meta">${t.count} utterances across ${t.fg_count} focus group${t.fg_count === 1 ? "" : "s"}</div>
      <div class="theme-def">${escape(t.definition || "")}</div>
      <div class="theme-examples"></div>
    `;
    const examples = div.querySelector(".theme-examples");
    for (const ex of t.examples || []) {
      const e = document.createElement("div");
      e.className = "theme-example";
      e.innerHTML = `${contextBlockHTML(ex.context, ex.quote || ex.text)}<cite>from the ${prettySection(ex.section_id)} section</cite>`;
      examples.appendChild(e);
      attachReactionBar(e, "quote", `${ex.fg_id}:${ex.line_id}`);
    }
    el.appendChild(div);
  }
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
      const entries = Object.entries(two.by_fg)
        .filter(([_, row]) => (row.overuse || row.underuse || row.ambivalent))
        .sort();
      if (entries.length) {
        for (const [fgId, row] of entries) {
          const t = (row.overuse || 0) + (row.underuse || 0) + (row.ambivalent || 0);
          const letter = "ABCDEFGHIJK"[Object.keys(two.by_fg).sort().indexOf(fgId)] || "?";
          const row_html = `
            <div class="vote-fg-row">
              <span class="vote-fg-label">focus group ${letter}</span>
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
  }

  // --- Pair-share dots aggregate chart ---
  if (agg.length) {
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
    signinBtn.disabled = true;
    signinBtn.textContent = "reactions disabled";
    signinBtn.title = "Supabase not configured — see frontend/supabase/README.md";
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
  const root = document.getElementById("site-comments");
  root.innerHTML = `
    <form class="comment-form" id="comment-form">
      <textarea name="body" placeholder="say something back..." required></textarea>
      <button type="submit" class="btn-primary" style="font-family:var(--font-body);padding:0.6rem 1.1rem;">post</button>
    </form>
    <div class="comment-list" id="comment-list"></div>
  `;
  document.getElementById("comment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!supabase) { alert("supabase not configured"); return; }
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
  await renderThreeCodes();
  await renderDisagreements();
  await renderAiSlop();
  await renderFieldNotes();
  await renderThemes();
  await renderVotes();
  initStaticReactionBars();
  await initAuth();
  await initComments();
})();
