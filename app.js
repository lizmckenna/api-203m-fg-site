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

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) return null;
  return res.json();
}

async function loadJSONL(path) {
  const res = await fetch(path);
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

// Minimal markdown → HTML. Handles: # / ## / ###, **bold**, *italic*,
// [footnote refs], paragraph breaks, horizontal rules. Not a full markdown
// parser — just enough for this memo.
function mdToHTML(md) {
  const lines = md.split("\n");
  const out = [];
  const footnotes = {};
  const footnoteOrder = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      out.push(`<p>${para.join(" ")}</p>`);
      para = [];
    }
  };
  for (let raw of lines) {
    // Footnote definition: [^1]: body
    const fnDef = raw.match(/^\[\^(\w+)\]:\s*(.*)$/);
    if (fnDef) {
      flush();
      footnotes[fnDef[1]] = fnDef[2];
      footnoteOrder.push(fnDef[1]);
      continue;
    }
    if (raw === "") { flush(); continue; }
    if (raw === "---") { flush(); out.push("<hr>"); continue; }
    if (raw.startsWith("### ")) { flush(); out.push(`<h3>${inline(raw.slice(4))}</h3>`); continue; }
    if (raw.startsWith("## "))  { flush(); out.push(`<h2>${inline(raw.slice(3))}</h2>`); continue; }
    if (raw.startsWith("# "))   { flush(); out.push(`<h1>${inline(raw.slice(2))}</h1>`); continue; }
    para.push(inline(raw));
  }
  flush();
  if (footnoteOrder.length) {
    out.push('<div class="footnotes"><strong>Footnotes</strong>');
    footnoteOrder.forEach((k, i) => {
      out.push(`<p id="fn-${k}"><sup>${i + 1}</sup> ${inline(footnotes[k])}</p>`);
    });
    out.push("</div>");
  }
  return out.join("\n");

  function inline(s) {
    return escape(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|\s)\*([^*]+)\*(?=\s|$|[.,!?;:])/g, '$1<em>$2</em>')
      .replace(/\[\^(\w+)\]/g, '<sup><a href="#fn-$1">$1</a></sup>');
  }
}

// Extract a short preview (first 2-3 paragraphs of body, skipping headings).
function previewFromMD(md, maxChars = 520) {
  const paras = md
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("---") && !p.startsWith("["));
  let out = "";
  for (const p of paras) {
    if (out.length + p.length > maxChars) {
      out += (out ? " " : "") + p.slice(0, maxChars - out.length).replace(/\s\S*$/, "") + "…";
      break;
    }
    out += (out ? "\n\n" : "") + p;
  }
  return out
    .split("\n\n")
    .map((p) => `<p>${escape(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\s)\*([^*]+)\*/g, '$1<em>$2</em>')}</p>`)
    .join("");
}

async function renderMemo() {
  const res = await fetch("public/memo.md");
  if (!res.ok) return;
  const md = await res.text();
  document.getElementById("memo-preview").innerHTML = previewFromMD(md, 520);
  document.getElementById("memo-full").innerHTML = mdToHTML(md);
  document.getElementById("memo-open").addEventListener("click", () =>
    document.getElementById("memo-dialog").showModal()
  );
  document.getElementById("memo-close").addEventListener("click", () =>
    document.getElementById("memo-dialog").close()
  );
  document.getElementById("memo-dialog").addEventListener("click", (e) => {
    // Click on backdrop closes
    if (e.target.tagName === "DIALOG") e.target.close();
  });
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
  // Serve positionality.md from the repo root via a simple copy: the Makefile
  // should copy it into public/ on build. For now, try public/positionality.md
  // first, then fall back to a shim.
  const res = await fetch("public/positionality.md");
  const el = document.getElementById("positionality-body");
  if (!res.ok) {
    el.innerHTML = "<p>Positionality statement not yet built into <code>public/</code>. Run <code>make publish</code>.</p>";
    return;
  }
  const md = await res.text();
  // Minimal markdown: paragraph breaks + bold
  el.innerHTML = md
    .split(/\n\n+/)
    .map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, " ")}</p>`)
    .join("\n");
}

async function renderThreeCodes() {
  const seg = await loadJSONL("public/data/coded_segments.jsonl");
  const el = document.getElementById("three-codes-table");
  if (!seg.length) return;

  // Group by (fg_id, line_id) so each row shows all coders for the same utterance
  const grouped = new Map();
  for (const s of seg) {
    const key = `${s.fg_id}:${s.line_id}`;
    if (!grouped.has(key)) grouped.set(key, { fg_id: s.fg_id, line_id: s.line_id, text: s.text, coders: {} });
    grouped.get(key).coders[s.coder] = s;
  }

  // Show at most 25 rows — prefer rows that have LM AND llm-claude, then rows with both + invivo
  const rows = [...grouped.values()]
    .sort((a, b) => Object.keys(b.coders).length - Object.keys(a.coders).length)
    .slice(0, 25);

  el.innerHTML = "";
  for (const row of rows) {
    const div = document.createElement("div");
    div.className = "three-code-row";
    const lm = row.coders["LM"];
    const llm = row.coders["llm-claude"];
    const iv = row.coders["invivo"];
    div.innerHTML = `
      <div>
        <div class="utterance">${escape(row.text)}</div>
        <div class="fg-id">${row.fg_id} · line ${row.line_id}</div>
      </div>
      <div class="codes">${codesHTML(lm?.codes, "lm")}</div>
      <div class="codes">${codesHTML(llm?.codes, "llm")}</div>
      <div class="codes">${codesHTML(iv?.codes, "invivo")}</div>
    `;
    el.appendChild(div);
  }
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
      <blockquote>"${escape(r.text)}"</blockquote>
      <div class="diff-row"><span class="diff-label">LM</span>    <span>${r.lm_codes.join(", ") || "—"}</span></div>
      <div class="diff-row"><span class="diff-label">Claude</span> <span>${r.llm_codes.join(", ") || "—"}</span></div>
      <div class="diff-row"><span class="diff-label">only LM</span><span>${r.only_lm.join(", ") || "—"}</span></div>
      <div class="diff-row"><span class="diff-label">only Claude</span><span>${r.only_llm.join(", ") || "—"}</span></div>
    `;
    el.appendChild(div);
    attachReactionBar(div, "disagreement", `${r.fg_id}:${r.line_id}`);
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
      e.innerHTML = `"${escape(ex.quote || ex.text)}"<cite>${ex.fg_id} · ${ex.section_id}</cite>`;
      examples.appendChild(e);
      attachReactionBar(e, "quote", `${ex.fg_id}:${ex.line_id}`);
    }
    el.appendChild(div);
  }
}

async function renderVotes() {
  const votes = await loadJSON("public/data/vote_tallies.json");
  const el = document.getElementById("votes-body");
  if (!votes || !votes.two_sided_risk || votes.two_sided_risk.overuse === null) return;

  el.innerHTML = "";
  const r = votes.two_sided_risk;
  const total = (r.overuse || 0) + (r.underuse || 0);
  el.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:var(--fs-h3);margin:0 0 .5rem 0;">two-sided risk vote</h3>
    <div class="vote-bar"><span class="label">concern 1: overuse</span><div class="bar"><div class="bar-fill" style="width:${(r.overuse/total*100).toFixed(0)}%"></div></div><span class="count">${r.overuse}</span></div>
    <div class="vote-bar"><span class="label">concern 2: underuse</span><div class="bar"><div class="bar-fill" style="width:${(r.underuse/total*100).toFixed(0)}%"></div></div><span class="count">${r.underuse}</span></div>
  `;
  if (votes.pair_share_dots && votes.pair_share_dots.length) {
    const h = document.createElement("h3");
    h.style.cssText = "font-family:var(--font-display);font-size:var(--fs-h3);margin:1rem 0 .5rem 0;";
    h.textContent = "pair-share top votes";
    el.appendChild(h);
    const max = Math.max(...votes.pair_share_dots.map(d => d.count));
    for (const d of votes.pair_share_dots.sort((a,b) => b.count - a.count)) {
      const row = document.createElement("div");
      row.className = "vote-bar";
      row.innerHTML = `<span class="label">${escape(d.item)}</span><div class="bar"><div class="bar-fill" style="width:${(d.count/max*100).toFixed(0)}%"></div></div><span class="count">${d.count}</span>`;
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
  if (!supabase) return;
  const { data } = await supabase.from("v_readership_mix").select("*");
  const el = document.getElementById("readership-mix");
  if (!data || !data.length) { el.textContent = "—"; return; }
  const lines = data.slice(0, 6).map((r) => `${r.n} ${r.program || r.role}`);
  el.innerHTML = lines.join("<br>");
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
  await renderThemes();
  await renderVotes();
  initStaticReactionBars();
  await initAuth();
  await initComments();
})();
