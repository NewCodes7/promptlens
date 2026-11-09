(() => {
  const TYPES = {
    investigate: { icon: "🔍", label: "Investigate", color: "investigate" },
    research: { icon: "🔍", label: "Research", color: "investigate" },
    plan: { icon: "🧭", label: "Plan", color: "plan" },
    build: { icon: "🛠️", label: "Build", color: "build" },
    create: { icon: "✍️", label: "Create", color: "build" },
    fix: { icon: "🐛", label: "Fix", color: "fix" },
    revise: { icon: "✏️", label: "Revise", color: "revise" },
    verify: { icon: "🧪", label: "Verify", color: "verify" },
    test: { icon: "🧪", label: "Test", color: "verify" },
    check: { icon: "🧪", label: "Check", color: "verify" },
    refactor: { icon: "♻️", label: "Refactor", color: "refactor" },
    docs: { icon: "📝", label: "Docs", color: "docs" },
    ship: { icon: "🚀", label: "Ship", color: "ship" },
    deliver: { icon: "🚀", label: "Deliver", color: "ship" },
  };
  const type = (t) => TYPES[t] || { icon: "🔸", label: t ? t[0].toUpperCase() + t.slice(1) : "Other", color: "custom" };
  const cvar = (t) => `var(--t-${type(t).color})`;
  const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  const AVATAR = ["#4f46e5", "#0891b2", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#dc2626"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const avatar = (name) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `<span class="avatar" style="background:${AVATAR[h % AVATAR.length]}">${esc(name[0].toUpperCase())}</span>`;
  };
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // ---------- data ----------
  const dev = window.PROMPTLENS_DEV;
  const extras = window.PROMPTLENS_DEV_EXTRAS;
  const minutesOf = (m) => (m.minutes != null ? m.minutes : Math.max(1, Math.round((new Date(m.end) - new Date(m.start)) / 60000)));
  const stories = [
    {
      id: "developer",
      profession: "Developer",
      emoji: "💻",
      live: true,
      ...extras,
      source: dev,
      turns: dev.turns.map((t, i) => ({
        ...t,
        translations: extras.translations[i] ? [extras.translations[i]] : [],
        links: t.commits.map((c) => `⎇ ${c}`),
      })),
    },
    ...window.PROMPTLENS_SAMPLES.map((s) => ({ ...s, live: false, turns: s.turns.map((t) => ({ ...t, translations: [], links: (t.artifacts || []).map((a) => `📄 ${a}`) })) })),
  ];

  const PATTERNS = [
    { title: "Let the AI interview you first", text: "Ask it to survey what's unclear before it builds anything.", refs: [["developer", 0], ["developer", 6]] },
    { title: "Show what good looks like", text: "References and past winners beat adjectives like 'clean' or 'catchy'.", refs: [["designer", 0], ["marketer", 2]] },
    { title: "Give the context it can't guess", text: "Your audience, your side, what's already done.", refs: [["professional", 1], ["designer", 2], ["developer", 1]] },
    { title: "Paste raw evidence, not your summary", text: "Notes, logs and rules let the AI find what you missed.", refs: [["founder", 3], ["professional", 2]] },
  ];

  // dominant type: most frequent step type, first wins ties (matches the CLI's flow chart)
  const dominant = (t) => {
    const n = {};
    let best = t.steps[0]?.type || "custom";
    for (const s of t.steps) {
      n[s.type] = (n[s.type] || 0) + 1;
      if (n[s.type] > (n[best] || 0)) best = s.type;
    }
    return best;
  };
  const chipTypes = (t) => {
    const seen = [];
    for (const s of t.steps) if (!seen.includes(s.type)) seen.push(s.type);
    return seen.slice(0, 5);
  };

  // ---------- state ----------
  const state = { story: "developer", open: new Set([0]), expandedSteps: new Set(), reacts: new Set(), comments: {} };
  try {
    const saved = JSON.parse(localStorage.getItem("plhub-view") || "{}");
    if (stories.some((s) => s.id === saved.story)) state.story = saved.story;
  } catch {}
  const fromHash = location.hash.slice(1);
  if (stories.some((s) => s.id === fromHash)) state.story = fromHash;
  const persist = () => {
    try {
      localStorage.setItem("plhub-view", JSON.stringify({ story: state.story }));
    } catch {}
  };

  // ---------- render ----------
  const $ = (id) => document.getElementById(id);

  function renderPatterns() {
    $("patterns").innerHTML = PATTERNS.map(
      (p) => `<div class="pattern"><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p><div class="refs">${p.refs
        .map(([sid, i]) => {
          const s = stories.find((x) => x.id === sid);
          return `<button class="ref" data-story="${sid}" data-turn="${i}">${s.emoji} ${esc(s.profession)} ${CIRCLED[i]}</button>`;
        })
        .join("")}</div></div>`,
    ).join("");
  }

  function renderTabs() {
    $("tabs").innerHTML = stories
      .map(
        (s) =>
          `<button class="tab" role="tab" aria-selected="${s.id === state.story}" data-story="${s.id}">${s.emoji} ${esc(s.profession)} <span class="badge ${s.live ? "live" : "sample"}">${s.live ? "Live · GitHub" : "Sample"}</span></button>`,
      )
      .join("");
  }

  function stepsHtml(t, i) {
    const all = t.steps;
    const expanded = state.expandedSteps.has(i) || all.length <= 8;
    const li = (s) => `<li><span>${type(s.type).icon}</span><span><b>${esc(type(s.type).label)}</b>${s.text ? ` — ${esc(s.text)}` : ""}</span></li>`;
    if (expanded) return `<ul class="steps">${all.map(li).join("")}</ul>`;
    return `<ul class="steps">${all.slice(0, 3).map(li).join("")}<li><span></span><button class="more" data-more="${i}">… show ${all.length - 8} more steps</button></li>${all.slice(-5).map(li).join("")}</ul>`;
  }

  function nodeHtml(s, t, i) {
    const d = dominant(t);
    const chips = chipTypes(t)
      .map((c) => `<span class="chip" style="--c:${cvar(c)}">${type(c).icon} ${esc(type(c).label)}</span>`)
      .join('<span class="arrow">→</span>');
    const m = t.metrics;
    const who = t.prompts.length ? `🧑 ${plural(t.prompts.length, "prompt")}` : "🤖 continued";
    const metrics = [`${plural(m.aiSteps, "AI step")}`, m.files ? plural(m.files, "file") : null, `${minutesOf(m)} min`, t.decisions.length ? plural(t.decisions.length, "decision") : null].filter(Boolean);
    const open = state.open.has(i);
    const prompts = t.prompts
      .map((p, k) => `<div class="prompt">${esc(p)}${k === t.prompts.length - 1 && t.translations[0] ? `<span class="tr">${esc(t.translations[0])}</span>` : ""}</div>`)
      .join("");
    const tips = [
      ...t.tips.keep.map((x) => `<div class="tip keep"><span>👍</span><span><b>Keep</b> — ${esc(x)}</span></div>`),
      ...t.tips.improve.map((x) => `<div class="tip try"><span>💡</span><span><b>Try</b> — ${esc(x)}</span></div>`),
    ].join("");
    const link = t.links.length ? `<div class="link"><span>${t.links.map(esc).join(" · ")}</span></div>` : "";
    return `<div class="node" style="--c:${cvar(d)}">
      <div class="rail"><span class="num">${i + 1}</span><span class="line"></span></div>
      <div>
        <div class="box${open ? " open" : ""}" id="turn-${i}">
          <button class="box-top" data-toggle="${i}" aria-expanded="${open}">
            <div class="box-title"><h4>${esc(t.title)}</h4><span class="who">${who} <span class="caret">›</span></span></div>
            <div class="chips">${chips}</div>
            ${t.outcome ? `<p class="outcome">✅ ${esc(t.outcome)}</p>` : ""}
            <div class="metrics">${metrics.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
          </button>
          <div class="detail">
            <h5>🧑 What they asked${t.translations[0] ? " · original" : ""}</h5>
            ${prompts || '<div class="prompt" style="color:var(--muted)">🤖 The AI continued an earlier request without a new prompt.</div>'}
            ${t.steps.length ? `<h5>🤖 What the AI did</h5>${stepsHtml(t, i)}` : ""}
            ${t.decisions.length ? `<h5>Decisions</h5><ul class="decisions">${t.decisions.map((x) => `<li><b>${esc(x.text)}</b>${x.why ? ` <span>— ${esc(x.why)}</span>` : ""}</li>`).join("")}</ul>` : ""}
            ${tips ? `<h5>🎯 Prompt review</h5><div class="review">${tips}</div>` : ""}
          </div>
        </div>
        ${link}
      </div>
    </div>`;
  }

  function renderStory() {
    const s = stories.find((x) => x.id === state.story);
    const turns = s.turns;
    const totals = turns.reduce(
      (a, t) => ({ prompts: a.prompts + t.prompts.length, ai: a.ai + t.metrics.aiSteps, files: a.files + (t.metrics.files || 0), min: a.min + minutesOf(t.metrics) }),
      { prompts: 0, ai: 0, files: 0, min: 0 },
    );
    const time = totals.min >= 90 ? `${Math.floor(totals.min / 60)}h ${totals.min % 60}m` : `${totals.min}m`;
    const legend = [...new Set(turns.flatMap((t) => t.steps.map((x) => x.type)))]
      .filter((t, i, arr) => arr.findIndex((o) => type(o).color === type(t).color) === i)
      .map((t) => `<span><span class="dot" style="background:${cvar(t)}"></span>${esc(type(t).label)}</span>`)
      .join("");
    const src = s.live
      ? `<span>📦 Captured from Claude Code sessions by the PromptLens CLI</span><a href="${esc(s.source.url)}">View on GitHub → ${esc(s.source.repo)}#${s.source.pr}</a>`
      : `<span>🧪 Illustrative sample — shows where PromptLens goes next</span>`;

    $("story").innerHTML = `
      <div class="author">${avatar(s.author.name)}<div><b>${esc(s.author.name)}</b> · ${esc(s.author.role)}</div>
        <span class="badge ${s.live ? "live" : "sample"}" style="margin-left:auto">${s.live ? "Real data" : "Sample"}</span></div>
      <h2>${esc(s.title)}</h2>
      <p class="goal">${esc(s.goal)}</p>
      ${s.note ? `<div class="note">ℹ️ ${esc(s.note)}</div>` : ""}
      <div class="stats">
        <div class="stat"><b>${turns.length}</b><span>requests</span></div>
        <div class="stat"><b>${totals.prompts}</b><span>prompts</span></div>
        <div class="stat"><b>${totals.ai}</b><span>AI steps</span></div>
        <div class="stat"><b>${s.live ? s.source.commits : totals.files}</b><span>${s.live ? "commits" : "files"}</span></div>
        <div class="stat"><b>${time}</b><span>with AI</span></div>
      </div>
      <div class="source">${src}</div>
      <div class="flow-head"><h3>How it was built — the prompt flow</h3><div class="legend">${legend}</div></div>
      <div class="minimap">${turns
        .map((t, i) => `<button class="seg" style="--c:${cvar(dominant(t))}" data-jump="${i}" title="${esc(t.title)}">${CIRCLED[i] || i + 1}</button>`)
        .join("")}</div>
      <div class="flow">${turns.map((t, i) => nodeHtml(s, t, i)).join("")}</div>`;
  }

  function renderAside() {
    const s = stories.find((x) => x.id === state.story);
    const keeps = s.turns.flatMap((t) => t.tips.keep).length;
    const tries = s.turns.flatMap((t) => t.tips.improve).length;
    const extra = state.comments[s.id] || [];
    const comments = [...s.comments.map((c) => ({ ...c, sample: true })), ...extra];
    const r = (k, label, base) => {
      const on = state.reacts.has(`${s.id}:${k}`);
      return `<button class="react${on ? " on" : ""}" data-react="${k}">${label} ${base + (on ? 1 : 0)}</button>`;
    };
    $("aside").innerHTML = `
      <section class="card panel">
        <h3>🎓 What you can learn here</h3>
        <div class="sub">Knowledge this flow needed</div>
        <ul>${s.learn.gaps.map((g) => `<li><span>📚</span><span>${esc(g)}</span></li>`).join("")}</ul>
        <div class="sub">Prompt patterns worth copying</div>
        <ul>${s.learn.patterns.map((g) => `<li><span>✨</span><span>${esc(g)}</span></li>`).join("")}</ul>
        <div class="hint">From ${plural(keeps, "👍 keep")} and ${plural(tries, "💡 try")} in the prompt reviews.</div>
      </section>
      <section class="card panel">
        <h3>💬 Discussion</h3>
        <div class="reacts">${r("learned", "🎓 Learned something", s.live ? 12 : 8)}${r("saved", "🔖 Save flow", s.live ? 5 : 3)}</div>
        ${comments
          .map(
            (c) => `<div class="comment">${avatar(c.name)}<div><div class="meta"><b>${esc(c.name)}</b> · ${esc(c.role)}${c.sample ? "" : " · just now"}</div><p>${esc(c.text)}</p></div></div>`,
          )
          .join("")}
        <form class="compose" id="compose"><input id="compose-input" placeholder="What would you add to these prompts?" aria-label="Write a comment" maxlength="280" /><button type="submit">Post</button></form>
        <div class="hint">Demo discussion: sample comments and counts; your post stays on this page only.</div>
      </section>`;
  }

  function renderAll() {
    renderTabs();
    renderStory();
    renderAside();
  }

  function selectStory(id, turn) {
    state.story = id;
    state.open = new Set([turn ?? 0]);
    state.expandedSteps = new Set();
    persist();
    history.replaceState(null, "", `#${id}`);
    renderAll();
    if (turn != null) {
      requestAnimationFrame(() => document.getElementById(`turn-${turn}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
  }

  // ---------- events ----------
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-story],[data-toggle],[data-jump],[data-more],[data-react]");
    if (!el) return;
    if (el.dataset.story) return selectStory(el.dataset.story, el.dataset.turn != null ? Number(el.dataset.turn) : undefined);
    if (el.dataset.toggle != null) {
      const i = Number(el.dataset.toggle);
      state.open.has(i) ? state.open.delete(i) : state.open.add(i);
      const box = document.getElementById(`turn-${i}`);
      box.classList.toggle("open", state.open.has(i));
      el.setAttribute("aria-expanded", state.open.has(i));
      return;
    }
    if (el.dataset.jump != null) {
      const i = Number(el.dataset.jump);
      state.open.add(i);
      renderStory();
      document.getElementById(`turn-${i}`).scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (el.dataset.more != null) {
      state.expandedSteps.add(Number(el.dataset.more));
      return renderStory();
    }
    if (el.dataset.react) {
      const k = `${state.story}:${el.dataset.react}`;
      state.reacts.has(k) ? state.reacts.delete(k) : state.reacts.add(k);
      return renderAside();
    }
  });
  document.addEventListener("submit", (e) => {
    if (e.target.id !== "compose") return;
    e.preventDefault();
    const v = $("compose-input").value.trim();
    if (!v) return;
    (state.comments[state.story] ||= []).push({ name: "You", role: "Visitor", text: v });
    renderAside();
  });

  $("theme").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try {
      localStorage.setItem("plhub-theme", root.dataset.theme);
    } catch {}
  });
  try {
    const t = localStorage.getItem("plhub-theme");
    if (t) document.documentElement.dataset.theme = t;
  } catch {}

  addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (id !== state.story && stories.some((s) => s.id === id)) selectStory(id);
  });

  renderPatterns();
  renderAll();
})();
