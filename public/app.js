/* Pack Pal front end. Plain JavaScript, no build step. */
(() => {
  'use strict';
  const E = window.PackEngine;

  // ---------------------------------------------------------------- state
  const S = { members: [], types: [], trips: [], rev: 0, loaded: false };
  const prefs = loadPrefs();
  let current = null; // { name, refresh?, dirty? }

  function loadPrefs() {
    try { return Object.assign({ me: null, group: 'category', hidePacked: false }, JSON.parse(localStorage.getItem('packpal.prefs') || '{}')); }
    catch { return { me: null, group: 'category', hidePacked: false }; }
  }
  function savePrefs() { try { localStorage.setItem('packpal.prefs', JSON.stringify(prefs)); } catch { /* private mode */ } }

  const typeById = (id) => S.types.find((t) => t.id === id);
  const core = () => S.types.find((t) => t.essentials);
  const tripById = (id) => S.trips.find((t) => t.id === id);
  const member = (id) => S.members.find((m) => m.id === id);
  const travelersOf = (trip) => trip.travelers.map(member).filter(Boolean);

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const plural = (n, w, p) => n + ' ' + (n === 1 ? w : (p || w + 's'));
  const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

  function fmtDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
    if (!iso) return '';
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, opts);
  }
  function dateRange(trip) {
    if (!trip.start) return plural(trip.nights, 'night');
    const end = trip.end && trip.end !== trip.start ? ' – ' + fmtDate(trip.end) : '';
    return fmtDate(trip.start) + end + ' · ' + plural(trip.nights, 'night');
  }
  function countdown(trip) {
    if (!trip.start) return '';
    const t = todayISO();
    const days = E.nightsBetween(t, trip.start);
    if (trip.start > t) return days === 1 ? 'Tomorrow!' : `In ${days} days`;
    if (trip.start === t) return 'Today!';
    if (!trip.end || trip.end >= t) return 'Happening now';
    return 'Finished';
  }

  function avatar(m, size) {
    if (!m) return '';
    const st = `background:${m.color}22;${size ? `width:${size}px;height:${size}px;` : ''}`;
    return `<span class="avatar" style="${st}" title="${esc(m.name)}">${esc(m.emoji)}</span>`;
  }

  async function api(method, path, body) {
    const res = await fetch('/api/' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.passwordRequired) { showLogin(); throw new Error('login'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button>${esc(action.label)}</button>` : '');
    if (action) $('button', t).onclick = () => { t.classList.remove('show'); action.run(); };
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : 2600);
  }
  const fail = (e) => { if (e.message !== 'login') toast('⚠️ ' + e.message); };

  function modal(html, onMount) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
    const bg = $('.modal-bg', root);
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
    $$('[data-close]', root).forEach((b) => (b.onclick = close));
    onMount && onMount($('.modal', root), close);
    const first = $('input, select, textarea', root);
    first && setTimeout(() => first.focus(), 50);
    return close;
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise((resolve) => {
      modal(`<h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
        <div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="ok">${esc(okLabel)}</button></div>`,
      (m, close) => { $('#ok', m).onclick = () => { close(); resolve(true); }; $$('[data-close]', m).forEach((b) => b.addEventListener('click', () => resolve(false))); });
    });
  }

  function confetti() {
    const cv = $('#confetti');
    const ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#14b8a6', '#f59e0b', '#ec4899', '#6366f1', '#22c55e', '#0ea5e9'];
    const bits = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .6,
      vx: (Math.random() - .5) * 16, vy: -Math.random() * 18 - 6, r: Math.random() * 6 + 4,
      c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6, va: (Math.random() - .5) * .4,
    }));
    let frame = 0;
    (function tick() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      bits.forEach((b) => {
        b.vy += .45; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.a += b.va;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore();
      });
      if (++frame < 160) requestAnimationFrame(tick); else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  // ---------------------------------------------------------------- data loading & live sync
  async function load() {
    const data = await api('GET', 'state');
    Object.assign(S, data, { loaded: true });
  }

  let es, reloadTimer;
  function connectLive() {
    if (es) es.close();
    es = new EventSource('/api/events');
    es.onopen = () => $('#live').classList.add('on');
    es.onerror = () => $('#live').classList.remove('on');
    es.onmessage = (ev) => {
      const { rev } = JSON.parse(ev.data);
      if (rev <= S.rev) return;
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(async () => {
        try { await load(); } catch { return; }
        if (current && (current.dirty || current.static)) return; // don't clobber an open editor or the wizard
        if (current && current.refresh) current.refresh(); else route();
      }, 120);
    };
  }

  // ---------------------------------------------------------------- router
  const routes = [
    [/^#?\/?$/, viewHome],
    [/^#\/new$/, () => viewWizard()],
    [/^#\/trip\/([\w-]+)$/, viewTrip],
    [/^#\/trip\/([\w-]+)\/edit$/, (id) => viewWizard(id)],
    [/^#\/trip\/([\w-]+)\/review$/, viewReview],
    [/^#\/types$/, viewTypes],
    [/^#\/types\/([\w-]+)$/, viewTypeEditor],
    [/^#\/family$/, viewFamily],
  ];
  let lastHash = location.hash;
  function route() {
    if (!S.loaded) return;
    const hash = location.hash || '#/';
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) {
        current = { name: hash };
        $('#modal-root').innerHTML = '';
        $$('.nav a').forEach((a) => a.classList.toggle('active',
          (a.dataset.nav === 'home' && (hash === '#/' || hash.startsWith('#/trip') || hash === '#/new')) ||
          (a.dataset.nav !== 'home' && hash.startsWith('#/' + a.dataset.nav))));
        app.classList.remove('view-enter'); void app.offsetWidth; app.classList.add('view-enter');
        fn(...m.slice(1));
        return;
      }
    }
    location.hash = '#/';
  }
  window.addEventListener('hashchange', () => {
    if (current && current.dirty && !confirm('You have unsaved changes. Leave without saving?')) {
      history.replaceState(null, '', lastHash);
      return;
    }
    lastHash = location.hash;
    window.scrollTo(0, 0);
    route();
  });
  window.addEventListener('beforeunload', (e) => { if (current && current.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------------------------------------------------------------- login
  function showLogin() {
    app.innerHTML = `<div class="login card">
      <div style="font-size:3rem">🔐</div><h2 style="margin:8px 0 6px">Family password</h2>
      <p class="muted small">Enter it once and this device will remember it.</p>
      <form id="login" class="stack" style="margin-top:18px">
        <input class="input" type="password" name="pw" placeholder="Password" autocomplete="current-password" required>
        <button class="btn primary big" style="width:100%">Let me in</button>
        <p id="err" class="small" style="color:var(--danger)"></p>
      </form></div>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.pw.value }) });
      if (!res.ok) { $('#err').textContent = 'That is not the password. Try again.'; return; }
      boot();
    };
  }

  // ================================================================ HOME
  function tripCard(trip) {
    const type = typeById(trip.typeId) || { icon: '🧳', color: '#64748b', name: 'Trip' };
    const p = E.progress(trip.items);
    const cd = countdown(trip);
    return `<a class="card trip-card" href="#/trip/${trip.id}" style="--c:${type.color}">
      <div class="row" style="flex-wrap:nowrap">
        <div class="trip-icon">${type.icon}</div>
        <div style="flex:1;min-width:0">
          ${cd ? `<div class="countdown">${esc(cd)}</div>` : ''}
          <h3 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(trip.name)}</h3>
          <div class="muted small">${esc(dateRange(trip))}</div>
        </div>
        <div class="ring" style="--p:${p.pct}"><span>${p.pct}%</span></div>
      </div>
      <div class="spread">
        <div class="avatars">${travelersOf(trip).map((m) => avatar(m)).join('')}</div>
        <span class="faint small">${p.done} / ${p.total} packed</span>
      </div>
    </a>`;
  }

  function viewHome() {
    const active = S.trips.filter((t) => !t.archived).sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
    const past = S.trips.filter((t) => t.archived);
    const next = active.find((t) => t.start && t.start >= todayISO());
    const heroLine = next
      ? `Next up: <b>${esc(next.name)}</b>, ${esc(countdown(next).toLowerCase())}. You're ${E.progress(next.items).pct}% packed.`
      : 'Pick a kind of trip, answer a few quick questions, and get a packing list for the whole family.';
    const favorites = S.types.filter((t) => !t.essentials).slice(0, 7);
    app.innerHTML = `
      <section class="hero">
        <div class="hero-art">🧳</div>
        <h1>Where are we off to next?</h1>
        <p>${heroLine}</p>
        <a class="btn primary big" href="#/new">✨ Plan a trip</a>
      </section>

      ${S.members.length ? '' : `
      <div class="card row" style="margin-top:20px;flex-wrap:nowrap">
        <div style="font-size:2.2rem">👨‍👩‍👧‍👦</div>
        <div style="flex:1"><h3>First, who's in the family?</h3><p class="muted small">Add everyone once and Pack Pal makes a list for each person: right-sized clothes for the kids, diapers for the baby.</p></div>
        <a class="btn primary" href="#/family">Add family</a>
      </div>`}

      <div class="section-title"><h2>Upcoming trips</h2>${active.length ? `<span class="faint small">${plural(active.length, 'trip')}</span>` : ''}</div>
      ${active.length ? `<div class="grid cards">${active.map(tripCard).join('')}</div>` : `
        <div class="card empty"><div class="big-emoji">🗺️</div><h3 style="margin-top:8px">No trips planned yet</h3>
        <p class="muted small" style="margin:6px 0 16px">Start with one of your favorites:</p>
        <div class="row" style="justify-content:center">${favorites.map((t) => `<a class="chip toggle" href="#/new" data-type="${t.id}">${t.icon} ${esc(t.name)}</a>`).join('')}</div></div>`}

      ${past.length ? `<div class="section-title"><h2>Past trips</h2><span class="faint small">${plural(past.length, 'trip')}</span></div>
        <div class="grid cards" style="opacity:.8">${past.map(tripCard).join('')}</div>` : ''}
    `;
    $$('[data-type]').forEach((a) => a.addEventListener('click', () => { pendingType = a.dataset.type; }));
  }

  // ================================================================ WIZARD
  let pendingType = null;
  let wiz = null;

  function lastTravelersFor(typeId) {
    const prev = S.trips.find((t) => t.typeId === typeId);
    const ids = prev ? prev.travelers.filter((id) => member(id)) : [];
    return ids.length ? ids : S.members.filter(E.isPerson).map((m) => m.id);
  }

  function lastAnswersFor(typeId) {
    const prev = S.trips.find((t) => t.typeId === typeId);
    return prev ? clone(prev.answers) : null;
  }

  function startWizard(typeId) {
    const type = typeById(typeId);
    const start = addDays(todayISO(), 14);
    wiz = {
      step: 'details', typeId,
      name: type.name + (type.name.toLowerCase().includes('trip') ? '' : ' trip'),
      start, end: addDays(start, 2), nights: 2, useDates: true,
      travelers: lastTravelersFor(typeId),
      answers: Object.assign({}, core() ? defaultsFor(core()) : {}, type.defaults || {}, lastAnswersFor(typeId) || {}),
      remembered: !!lastAnswersFor(typeId),
      includeEssentials: true,
      qIndex: 0,
    };
  }
  function defaultsFor(type) { return clone(type.defaults || {}); }

  function wizardQuestions() {
    const type = typeById(wiz.typeId);
    const qs = [];
    if (wiz.includeEssentials && core()) qs.push(...core().questions);
    qs.push(...(type.questions || []));
    return qs.filter((q) => q.id !== 'laundry'); // asked next to the trip length
  }

  // One page per question, except the quick "easy to forget" checks, which share a final page.
  function wizardPages() {
    const qs = wizardQuestions();
    const pages = qs.filter((q) => !q.group).map((q) => [q]);
    const grouped = qs.filter((q) => q.group);
    if (grouped.length) pages.push(grouped);
    return pages;
  }

  function viewWizard(editTripId) {
    current.static = true;
    if (editTripId) {
      const trip = tripById(editTripId);
      if (!trip) return (location.hash = '#/');
      if (!wiz || wiz.editTripId !== editTripId) {
        wiz = {
          step: 'details', editTripId, typeId: trip.typeId, name: trip.name, start: trip.start, end: trip.end,
          nights: trip.nights, useDates: !!trip.start, travelers: [...trip.travelers], answers: clone(trip.answers),
          includeEssentials: trip.includeEssentials !== false, qIndex: 0,
        };
      }
    } else if (pendingType) {
      startWizard(pendingType);
      pendingType = null;
    } else if (!wiz || wiz.editTripId || wiz.step === 'build') {
      wiz = { step: 'type' };
    }
    renderWizard();
  }

  function wizSteps() {
    const total = 2 + (wiz.typeId ? wizardPages().length : 5);
    let done = 0;
    if (wiz.step === 'details') done = 1;
    if (wiz.step === 'q') done = 2 + wiz.qIndex;
    return `<div class="steps">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'done' : ''}"></i>`).join('')}</div>`;
  }

  function renderWizard() {
    if (wiz.step === 'type') return wizType();
    if (wiz.step === 'details') return wizDetails();
    if (wiz.step === 'q') return wizQuestion();
  }

  function wizType() {
    const types = S.types.filter((t) => !t.essentials);
    app.innerHTML = `<div class="wizard">${wizSteps()}
      <h1>What kind of trip?</h1>
      <p class="muted" style="margin-top:8px">Pick the closest one. You can tweak anything later.</p>
      <div class="grid types" style="margin-top:24px">
        ${types.map((t) => `<button class="type-tile" data-id="${t.id}" style="--c:${t.color}">
          <div class="trip-icon" style="--c:${t.color}">${t.icon}</div><b>${esc(t.name)}</b><small>${esc(t.description)}</small></button>`).join('')}
        <a class="type-tile" href="#/types" style="--c:var(--ink-3);text-decoration:none;justify-content:center;align-items:center;border-style:dashed">
          <div class="trip-icon" style="--c:var(--ink-3)">＋</div><b>New trip type</b></a>
      </div></div>`;
    $$('.type-tile[data-id]').forEach((b) => (b.onclick = () => { startWizard(b.dataset.id); renderWizard(); }));
  }

  function wizDetails() {
    const type = typeById(wiz.typeId);
    if (!type) { wiz.step = 'type'; return renderWizard(); }
    const people = S.members;
    app.innerHTML = `<div class="wizard">${wizSteps()}
      <div class="row" style="flex-wrap:nowrap;margin-bottom:6px"><div class="trip-icon" style="--c:${type.color}">${type.icon}</div>
        <h1>${wiz.editTripId ? 'Trip details' : 'Nice! Tell me about it.'}</h1></div>
      <div class="stack" style="margin-top:24px">
        <label class="field"><span>Trip name</span><input class="input" id="w-name" value="${esc(wiz.name)}" maxlength="80"></label>
        <div class="card stack">
          <div class="spread"><b>How long is the trip?</b>
            <label class="check small"><input type="checkbox" id="w-nodates" ${wiz.useDates ? '' : 'checked'}> No dates yet, just count nights</label></div>
          <div id="w-dates" class="editor-grid ${wiz.useDates ? '' : 'hidden'}">
            <label class="field"><span>Leaving</span><input class="input" type="date" id="w-start" value="${esc(wiz.start || '')}"></label>
            <label class="field"><span>Coming home</span><input class="input" type="date" id="w-end" value="${esc(wiz.end || '')}"></label>
          </div>
          <div id="w-nights" class="row ${wiz.useDates ? 'hidden' : ''}">
            <button class="icon-btn" id="w-minus" aria-label="Fewer nights" style="border:1px solid var(--line)">−</button>
            <span class="nights-badge" id="w-n"></span>
            <button class="icon-btn" id="w-plus" aria-label="More nights" style="border:1px solid var(--line)">＋</button>
          </div>
          <div class="spread" style="border-top:1px solid var(--line);padding-top:14px">
            <b>Do you plan to do laundry during the trip?</b>
            <div class="seg" id="w-laundry">
              <button data-v="yes" class="${wiz.answers.laundry === 'yes' ? 'on' : ''}">🧺 Yes</button>
              <button data-v="no" class="${wiz.answers.laundry === 'no' ? 'on' : ''}">No</button>
            </div>
          </div>
          <p class="small" id="w-sum" style="color:var(--brand);font-weight:600"></p>
        </div>
        <div class="card stack">
          <div class="spread"><b>Who's coming?</b><button class="btn small ghost" id="w-addp">＋ Add someone</button></div>
          <div class="people" id="w-people">
            ${people.length ? people.map((m) => `<button class="person ${wiz.travelers.includes(m.id) ? 'on' : ''}" data-id="${m.id}">${avatar(m)}${esc(m.name)}</button>`).join('')
              : '<p class="muted small">Add the people going so everyone gets their own list.</p>'}
          </div>
          <p class="muted small" id="w-profile"></p>
        </div>
        <label class="check"><input type="checkbox" id="w-ess" ${wiz.includeEssentials ? 'checked' : ''}> Include everyday essentials (toothbrush, chargers, clothes...)</label>
      </div>
      <div class="wizard-nav">
        <button class="btn ghost" id="w-back">← Back</button>
        <button class="btn primary big" id="w-next">Next →</button>
      </div></div>`;

    const sync = () => {
      if (wiz.useDates) wiz.nights = E.nightsBetween(wiz.start, wiz.end) ?? wiz.nights;
      $('#w-n').textContent = plural(wiz.nights, 'night');
      const days = wiz.nights + 1;
      const when = wiz.useDates && wiz.start ? fmtDate(wiz.start, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' : '';
      const wash = wiz.answers.laundry === 'yes' && days > E.LAUNDRY_CAP;
      $('#w-sum').textContent = `${when}${plural(wiz.nights, 'night')}, ${plural(days, 'day')}. ` + (wiz.answers.laundry === undefined
        ? 'Tell me about laundry and I\'ll size the clothes.'
        : wash ? `Everyone packs about ${E.LAUNDRY_CAP} days of clothes and washes the rest.` : `Everyone packs clothes for all ${days} days, plus a spare.`);
    };
    const profileHint = () => {
      const notes = wiz.travelers.map(member).filter(Boolean).flatMap((m) => {
        const needs = (m.needs || []).map((n) => E.NEEDS.find((x) => x.id === n)).filter(Boolean).map((n) => n.label.toLowerCase());
        const all = [...needs, ...(m.always || [])];
        return all.length ? [`${m.name}'s ${all.slice(0, 3).join(', ')}${all.length > 3 ? '…' : ''}`] : [];
      });
      $('#w-profile').innerHTML = notes.length
        ? `🧠 Remembered from Family: ${esc(notes.join('; '))}.`
        : S.members.length ? '💡 Add medication, glasses and must-brings to each person on the <a href="#/family">Family</a> page and they\'ll be on every list.' : '';
    };
    profileHint();
    $$('#w-laundry button').forEach((b) => (b.onclick = () => {
      wiz.answers.laundry = b.dataset.v;
      $$('#w-laundry button').forEach((x) => x.classList.toggle('on', x === b));
      sync();
    }));
    sync();
    $('#w-name').oninput = (e) => (wiz.name = e.target.value);
    $('#w-start').onchange = (e) => {
      const n = wiz.nights;
      wiz.start = e.target.value;
      if (!wiz.end || wiz.end < wiz.start) { wiz.end = addDays(wiz.start, n || 2); $('#w-end').value = wiz.end; }
      sync();
    };
    $('#w-end').onchange = (e) => { wiz.end = e.target.value; sync(); };
    $('#w-nodates').onchange = (e) => {
      wiz.useDates = !e.target.checked;
      $('#w-dates').classList.toggle('hidden', !wiz.useDates);
      $('#w-nights').classList.toggle('hidden', wiz.useDates);
      sync();
    };
    $('#w-minus').onclick = () => { wiz.nights = Math.max(0, wiz.nights - 1); sync(); };
    $('#w-plus').onclick = () => { wiz.nights = Math.min(60, wiz.nights + 1); sync(); };
    $$('#w-people .person').forEach((b) => (b.onclick = () => {
      const id = b.dataset.id;
      wiz.travelers = wiz.travelers.includes(id) ? wiz.travelers.filter((x) => x !== id) : [...wiz.travelers, id];
      b.classList.toggle('on');
      profileHint();
    }));
    $('#w-addp').onclick = () => memberModal(null, (m) => { wiz.travelers.push(m.id); wizDetails(); });
    $('#w-ess').onchange = (e) => (wiz.includeEssentials = e.target.checked);
    $('#w-back').onclick = () => {
      if (wiz.editTripId) location.hash = '#/trip/' + wiz.editTripId;
      else { wiz.step = 'type'; renderWizard(); }
    };
    $('#w-next').onclick = () => {
      if (wiz.useDates && (!wiz.start || !wiz.end || wiz.end < wiz.start)) return toast('Pick a leaving and coming-home date');
      if (!wiz.travelers.map(member).filter(Boolean).some(E.isPerson)) return toast(S.members.length ? 'Pick at least one person' : 'Add at least one person first');
      if (!wiz.useDates) { wiz.start = ''; wiz.end = ''; }
      wiz.step = 'q'; wiz.qIndex = 0; renderWizard();
    };
  }

  function wizQuestion() {
    const qs = wizardPages();
    if (wiz.qIndex >= qs.length) return wizBuild();
    if (qs[wiz.qIndex].length > 1) return wizChecks(qs);
    const q = qs[wiz.qIndex][0];
    const type = typeById(wiz.typeId);
    const val = wiz.answers[q.id];
    const opts = q.type === 'yesno' ? [{ value: 'yes', label: '👍 Yes' }, { value: 'no', label: '👎 No' }] : (q.options || []);
    const isOn = (v) => (Array.isArray(val) ? val.includes(v) : val === v);
    app.innerHTML = `<div class="wizard">${wizSteps()}
      <div class="question">
        <div class="row small faint" style="margin-bottom:10px"><span>${type.icon} ${esc(type.name)}</span><span>·</span><span>Question ${wiz.qIndex + 1} of ${qs.length}</span>
          ${wiz.remembered && val !== undefined ? '<span class="chip count">Remembered from last time</span>' : ''}</div>
        <h2>${esc(q.text)}</h2>
        ${q.help ? `<p class="muted">${esc(q.help)}</p>` : ''}
        ${q.type === 'number'
          ? `<input class="input" type="number" min="0" id="q-num" value="${esc(val ?? '')}" style="max-width:200px;margin-top:24px;font-size:1.3rem">`
          : `<div class="answers">${opts.map((o) => `<button class="answer ${isOn(o.value) ? 'on' : ''}" data-v="${esc(o.value)}">${esc(o.label)}<span class="tick">✓</span></button>`).join('')}</div>`}
      </div>
      <div class="wizard-nav">
        <button class="btn ghost" id="q-back">← Back</button>
        <div class="row"><button class="btn ghost" id="q-skip">Skip</button>
        <button class="btn primary big" id="q-next">${wiz.qIndex === qs.length - 1 ? '🎒 Build my list' : 'Next →'}</button></div>
      </div></div>`;
    const next = () => { wiz.qIndex++; renderWizard(); };
    $$('.answer').forEach((b) => (b.onclick = () => {
      const v = b.dataset.v;
      if (q.type === 'multi') {
        const cur = Array.isArray(wiz.answers[q.id]) ? wiz.answers[q.id] : [];
        wiz.answers[q.id] = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
        b.classList.toggle('on');
      } else {
        wiz.answers[q.id] = v;
        $$('.answer').forEach((x) => x.classList.toggle('on', x === b));
        setTimeout(next, 220);
      }
    }));
    const num = $('#q-num');
    if (num) { num.focus(); num.oninput = () => (wiz.answers[q.id] = num.value === '' ? undefined : Number(num.value)); num.onkeydown = (e) => { if (e.key === 'Enter') next(); }; }
    $('#q-skip').onclick = () => { delete wiz.answers[q.id]; next(); };
    $('#q-next').onclick = next;
    $('#q-back').onclick = () => { if (wiz.qIndex === 0) wiz.step = 'details'; else wiz.qIndex--; renderWizard(); };
  }

  // The "easy to forget" page: quick yes/no questions on one screen.
  function wizChecks(pages) {
    const qs = pages[wiz.qIndex];
    const type = typeById(wiz.typeId);
    const last = wiz.qIndex === pages.length - 1;
    app.innerHTML = `<div class="wizard">${wizSteps()}
      <div class="question">
        <div class="row small faint" style="margin-bottom:10px"><span>${type.icon} ${esc(type.name)}</span><span>·</span><span>Last check</span>
          ${wiz.remembered ? '<span class="chip count">Remembered from last time</span>' : ''}</div>
        <h2>Easy-to-forget check ✋</h2>
        <p class="muted">These are the things people most often leave behind. Tap Yes for anything that applies.</p>
        <div class="list checks" style="margin-top:20px">
          ${qs.map((q) => `<div class="check-row" data-q="${esc(q.id)}">
            <span class="item-name">${esc(q.text)}</span>
            <div class="seg"><button data-v="yes" class="${wiz.answers[q.id] === 'yes' ? 'on yes' : ''}">Yes</button><button data-v="no" class="${wiz.answers[q.id] === 'no' ? 'on' : ''}">No</button></div>
          </div>`).join('')}
        </div>
      </div>
      <div class="wizard-nav">
        <button class="btn ghost" id="q-back">← Back</button>
        <button class="btn primary big" id="q-next">${last ? '🎒 Build my list' : 'Next →'}</button>
      </div></div>`;
    $$('.check-row').forEach((row) => $$('button', row).forEach((b) => (b.onclick = () => {
      wiz.answers[row.dataset.q] = b.dataset.v;
      $$('button', row).forEach((x) => x.classList.toggle('on', x === b));
      $$('button', row).forEach((x) => x.classList.toggle('yes', x === b && b.dataset.v === 'yes'));
    })));
    $('#q-next').onclick = () => { wiz.qIndex++; renderWizard(); };
    $('#q-back').onclick = () => { if (wiz.qIndex === 0) wiz.step = 'details'; else wiz.qIndex--; renderWizard(); };
  }

  async function wizBuild() {
    wiz.step = 'build';
    const type = typeById(wiz.typeId);
    app.innerHTML = `<div class="building"><div class="suitcase">${type.icon}</div>
      <h2 style="margin-top:20px">Packing your bags...</h2><p class="muted" id="b-msg">Checking the weather report</p></div>`;
    const msgs = ['Counting socks', 'Finding the chargers', 'Folding tiny T-shirts', 'Remembering the toothbrushes'];
    let i = 0;
    const iv = setInterval(() => { const el = $('#b-msg'); if (el) el.textContent = msgs[i++ % msgs.length]; }, 350);
    const travelers = wiz.travelers.map(member).filter(Boolean);
    const tripShape = { nights: wiz.nights, answers: wiz.answers, includeEssentials: wiz.includeEssentials };
    const items = E.generate({ core: core(), type, trip: tripShape, travelers });
    const payload = {
      name: wiz.name.trim() || type.name, typeId: wiz.typeId, start: wiz.start, end: wiz.end, nights: wiz.nights,
      travelers: wiz.travelers, answers: wiz.answers, includeEssentials: wiz.includeEssentials,
    };
    try {
      await new Promise((r) => setTimeout(r, 1100));
      let trip;
      if (wiz.editTripId) {
        const old = tripById(wiz.editTripId);
        payload.items = mergeItems(old.items, items);
        trip = await api('PUT', 'trips/' + wiz.editTripId, payload);
      } else {
        payload.items = items;
        trip = await api('POST', 'trips', payload);
      }
      const idx = S.trips.findIndex((t) => t.id === trip.id);
      if (idx === -1) S.trips.unshift(trip); else S.trips[idx] = trip;
      clearInterval(iv);
      const editing = !!wiz.editTripId;
      wiz = null;
      location.hash = '#/trip/' + trip.id;
      toast(editing ? '✅ List updated. Packed items kept.' : `🎉 ${plural(trip.items.length, 'item')} ready to pack!`);
    } catch (e) {
      clearInterval(iv);
      fail(e);
      wiz.step = 'q'; wiz.qIndex = Math.max(0, wizardPages().length - 1); renderWizard();
    }
  }

  // Keep progress when answers change: same item id keeps its checked state & manual edits.
  function mergeItems(oldItems, newItems) {
    const byId = new Map(oldItems.map((i) => [i.id, i]));
    const merged = newItems.map((n) => {
      const o = byId.get(n.id);
      if (!o) return n;
      return Object.assign(n, {
        checked: o.checked, checkedBy: o.checkedBy, skipped: o.skipped,
        qty: o.qtyEdited ? o.qty : n.qty, qtyEdited: o.qtyEdited, name: o.nameEdited ? o.name : n.name, nameEdited: o.nameEdited,
        note: o.note || n.note,
      });
    });
    oldItems.filter((o) => o.custom).forEach((o) => merged.push(o));
    return merged;
  }

  // ================================================================ TRIP
  const view = { tab: 'all' };

  function viewTrip(id) {
    const trip = tripById(id);
    if (!trip) { app.innerHTML = '<div class="card empty"><div class="big-emoji">🤷</div><h3>That trip is gone</h3><a class="btn" href="#/" style="margin-top:12px">Back to trips</a></div>'; return; }
    if (view.tripId !== id) { view.tripId = id; view.tab = 'all'; }
    const type = typeById(trip.typeId) || { icon: '🧳', color: '#64748b', name: 'Trip' };
    const travelers = travelersOf(trip);
    if (!prefs.me || !member(prefs.me)) prefs.me = null;

    app.innerHTML = `
      <div style="--c:${type.color}">
        <a href="#/" class="btn ghost small no-print" style="margin-bottom:12px">← All trips</a>
        <div class="trip-head">
          <div class="trip-icon">${type.icon}</div>
          <div style="flex:1;min-width:0">
            <div class="countdown" id="t-cd"></div>
            <h1 style="font-size:clamp(1.6rem,4vw,2.2rem)">${esc(trip.name)}</h1>
            <div class="muted">${esc(dateRange(trip))} · ${esc(type.name)}</div>
          </div>
          <button class="icon-btn no-print" id="t-menu" aria-label="Trip options" style="font-size:1.4rem">⋯</button>
        </div>
        <div class="card" style="margin-top:20px;padding:16px 20px">
          <div class="spread" style="margin-bottom:10px"><b id="t-prog"></b><span class="faint small" id="t-left"></span></div>
          <div class="bar"><i id="t-bar"></i></div>
        </div>
        <div class="toolbar" style="margin-top:18px">
          <div class="seg" id="t-group">
            <button data-g="category" class="${prefs.group === 'category' ? 'on' : ''}">By category</button>
            <button data-g="person" class="${prefs.group === 'person' ? 'on' : ''}">By person</button>
          </div>
          <label class="check small"><input type="checkbox" id="t-hide" ${prefs.hidePacked ? 'checked' : ''}> Hide packed</label>
          <span style="flex:1"></span>
          <label class="small muted row" style="gap:6px">I'm
            <select class="input sm" id="t-me" style="width:auto">
              <option value="">someone</option>
              ${S.members.filter(E.isPerson).map((m) => `<option value="${m.id}" ${prefs.me === m.id ? 'selected' : ''}>${esc(m.emoji + ' ' + m.name)}</option>`).join('')}
            </select></label>
        </div>
        ${travelers.length > 1 ? `<div class="tabs" id="t-tabs" style="margin-top:14px"></div>` : ''}
        <div id="t-list"></div>
      </div>
      <form class="add-bar no-print" id="t-add" autocomplete="off">
        <input class="input" name="name" placeholder="Add something to pack..." maxlength="120" required>
        <select class="input" name="owner" aria-label="For whom">
          <option value="">Shared</option>
          ${travelers.length > 1 ? '<option value="*">Everyone</option>' : ''}
          ${travelers.map((m) => `<option value="${m.id}">${esc(m.emoji + ' ' + m.name)}</option>`).join('')}
        </select>
        <select class="input" name="category" aria-label="Category">
          ${E.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === 'misc' ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}
        </select>
        <button class="btn primary">Add</button>
      </form>`;

    $$('#t-group button').forEach((b) => (b.onclick = () => {
      prefs.group = b.dataset.g; savePrefs();
      $$('#t-group button').forEach((x) => x.classList.toggle('on', x === b));
      renderList();
    }));
    $('#t-hide').onchange = (e) => { prefs.hidePacked = e.target.checked; savePrefs(); renderList(); };
    $('#t-me').onchange = (e) => { prefs.me = e.target.value || null; savePrefs(); };
    $('#t-menu').onclick = (e) => tripMenu(e.currentTarget, trip.id);
    $('#t-add').onsubmit = (e) => { e.preventDefault(); addItem(trip.id, e.target); };

    current.refresh = () => { if (!tripById(id)) return route(); renderList(); };
    renderList();

    function renderList() {
      const t = tripById(id);
      const tr = travelersOf(t);
      const p = E.progress(t.items);
      $('#t-cd').textContent = countdown(t);
      $('#t-prog').textContent = p.pct === 100 ? '🎉 All packed! Have an amazing trip.' : `${p.done} of ${p.total} packed`;
      $('#t-left').textContent = p.pct === 100 ? '' : `${p.total - p.done} to go`;
      $('#t-bar').style.width = p.pct + '%';

      const tabs = $('#t-tabs');
      if (tabs) {
        const cnt = (pred) => { const xs = t.items.filter((i) => !i.skipped && pred(i)); return `${xs.filter((i) => i.checked).length}/${xs.length}`; };
        tabs.innerHTML = `<button class="tab text ${view.tab === 'all' ? 'on' : ''}" data-t="all">Everyone <span class="count">${cnt(() => true)}</span></button>` +
          tr.map((m) => `<button class="tab ${view.tab === m.id ? 'on' : ''}" data-t="${m.id}">${avatar(m)}${esc(m.name)} <span class="count">${cnt((i) => i.owner === m.id)}</span></button>`).join('') +
          `<button class="tab text ${view.tab === 'shared' ? 'on' : ''}" data-t="shared">🧺 Shared <span class="count">${cnt((i) => !i.owner)}</span></button>`;
        $$('.tab', tabs).forEach((b) => (b.onclick = () => { view.tab = b.dataset.t; renderList(); }));
      }

      let items = t.items.slice();
      if (view.tab === 'shared') items = items.filter((i) => !i.owner);
      else if (view.tab !== 'all') items = items.filter((i) => i.owner === view.tab);
      const hiddenCount = prefs.hidePacked ? items.filter((i) => i.checked).length : 0;
      if (prefs.hidePacked) items = items.filter((i) => !i.checked);

      const catOrder = E.CATEGORIES.map((c) => c.id);
      const byCat = (a, b) => catOrder.indexOf(a.category) - catOrder.indexOf(b.category) || a.name.localeCompare(b.name);
      let groups = [];
      if (prefs.group === 'person') {
        const owners = [...tr.map((m) => m.id), null];
        groups = owners.map((o) => {
          const m = o && member(o);
          return { key: o || 'shared', title: m ? m.name : 'Shared', icon: m ? avatar(m, 28) : '🧺', items: items.filter((i) => (i.owner || null) === o).sort(byCat) };
        });
      } else {
        groups = E.CATEGORIES.map((c) => ({ key: c.id, title: c.label, icon: c.icon, items: items.filter((i) => (catOrder.includes(i.category) ? i.category : 'misc') === c.id) }));
        groups.forEach((g) => g.items.sort((a, b) => a.name.localeCompare(b.name) || (a.owner || '').localeCompare(b.owner || '')));
      }
      groups = groups.filter((g) => g.items.length);

      const list = $('#t-list');
      if (!groups.length) {
        list.innerHTML = `<div class="card empty" style="margin-top:22px"><div class="big-emoji">${hiddenCount ? '✅' : '📝'}</div>
          <h3 style="margin-top:8px">${hiddenCount ? `All ${hiddenCount} items here are packed` : 'Nothing here yet'}</h3>
          <p class="muted small">${hiddenCount ? 'Untick "Hide packed" to see them.' : 'Add something with the bar at the bottom.'}</p></div>`;
        return;
      }
      list.innerHTML = groups.map((g) => {
        const done = g.items.filter((i) => i.checked).length;
        return `<section class="group"><div class="group-head"><span style="font-size:1.2rem">${g.icon}</span><h3>${esc(g.title)}</h3><span class="faint">${done}/${g.items.length}</span></div>
          <div class="list">${rowsFor(g.items, tr)}</div></section>`;
      }).join('');
      $$('.item[data-id]', list).forEach((row) => {
        const itemId = row.dataset.id;
        $('.box', row).onclick = () => toggleItem(id, itemId);
        $('.item-main', row).onclick = () => itemModal(id, itemId);
      });
      $$('.item[data-ids]', list).forEach((row) => {
        const ids = row.dataset.ids.split(' ');
        $('.box', row).onclick = () => toggleMany(id, ids);
        $('.item-main', row).onclick = () => toggleMany(id, ids);
        $$('.who-pill', row).forEach((b) => (b.onclick = () => toggleItem(id, b.dataset.id)));
      });
    }
  }

  // In the "Everyone" view: one row per item, with a tickable avatar for each person.
  function rowsFor(items, travelers) {
    const cluster = prefs.group === 'category' && view.tab === 'all' && travelers.length > 1;
    if (!cluster) return items.map((i) => itemRow(i, false)).join('');
    const groups = new Map();
    items.forEach((i) => {
      const key = i.owner ? E.slug(i.name) + '|' + i.category : 'solo|' + i.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(i);
    });
    return [...groups.values()].map((g) => (g.length === 1 && !g[0].owner ? itemRow(g[0], false) : clusterRow(g))).join('');
  }

  function clusterRow(g) {
    const done = g.every((i) => i.checked || i.skipped);
    const qtys = new Set(g.map((i) => i.qty));
    const withNote = g.find((i) => i.note);
    const pills = g.map((i) => {
      const m = member(i.owner);
      if (!m) return '';
      const badge = qtys.size > 1 && i.qty > 1 ? `<small>${i.qty}</small>` : '';
      return `<button class="who-pill ${i.checked ? 'on' : ''} ${i.skipped ? 'skip' : ''}" data-id="${esc(i.id)}" title="${esc(m.name)}${i.qty > 1 ? ' ×' + i.qty : ''}" style="--mc:${m.color}">${esc(m.emoji)}${badge}</button>`;
    }).join('');
    return `<div class="item ${done ? 'done' : ''}" data-ids="${esc(g.map((i) => i.id).join(' '))}">
      <button class="box" aria-label="Pack ${esc(g[0].name)} for everyone">✓</button>
      <div class="item-main" style="cursor:pointer">
        <div class="item-name">${esc(g[0].name)}</div>
        ${withNote ? `<div class="item-note">${esc(withNote.note)}</div>` : ''}
      </div>
      <div class="who-pills">${pills}</div>
      ${qtys.size === 1 && g[0].qty > 1 ? `<span class="qty">×${g[0].qty} each</span>` : ''}
    </div>`;
  }

  async function toggleMany(tripId, ids) {
    const trip = tripById(tripId);
    const items = trip.items.filter((i) => ids.includes(i.id) && !i.skipped);
    const target = !items.every((i) => i.checked);
    const before = E.progress(trip.items).pct;
    items.forEach((i) => { i.checked = target; i.checkedBy = target ? prefs.me : null; });
    current.refresh && current.refresh();
    if (E.progress(trip.items).pct === 100 && before < 100) confetti();
    await tripOps(tripId, items.map((i) => ({ op: 'check', itemId: i.id, checked: target, by: prefs.me })));
  }

  function itemRow(i, showOwner) {
    const m = i.owner && member(i.owner);
    const by = i.checked && i.checkedBy && member(i.checkedBy);
    const cat = E.categoryOf(i.category);
    return `<div class="item ${i.checked ? 'done' : ''} ${i.skipped ? 'skipped' : ''}" data-id="${esc(i.id)}">
      <button class="box" aria-label="${i.checked ? 'Unpack' : 'Pack'} ${esc(i.name)}">✓</button>
      ${showOwner && m ? avatar(m, 28) : ''}
      <div class="item-main" style="cursor:pointer">
        <div class="item-name">${esc(i.name)}${i.skipped ? ' <span class="faint small">(not this time)</span>' : ''}</div>
        ${i.note ? `<div class="item-note">${esc(i.note)}</div>` : ''}
        ${by ? `<div class="by">packed by ${esc(by.name)}</div>` : ''}
        ${prefs.group === 'person' ? `<div class="by">${cat.icon} ${esc(cat.label)}</div>` : ''}
      </div>
      ${i.qty > 1 ? `<span class="qty">×${i.qty}</span>` : ''}
    </div>`;
  }

  async function tripOps(tripId, ops) {
    try {
      const trip = await api('POST', `trips/${tripId}/ops`, { ops });
      const idx = S.trips.findIndex((t) => t.id === tripId);
      if (idx !== -1) S.trips[idx] = trip;
      S.rev++; // our own change; the live event that follows is harmless
      return trip;
    } catch (e) { fail(e); }
  }

  async function toggleItem(tripId, itemId) {
    const trip = tripById(tripId);
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) return;
    const before = E.progress(trip.items).pct;
    item.checked = !item.checked;
    item.checkedBy = item.checked ? prefs.me : null;
    current.refresh && current.refresh();
    const after = E.progress(trip.items).pct;
    if (after === 100 && before < 100) confetti();
    await tripOps(tripId, [{ op: 'check', itemId, checked: item.checked, by: prefs.me }]);
  }

  async function addItem(tripId, form) {
    const trip = tripById(tripId);
    const name = form.name.value.trim();
    if (!name) return;
    const category = form.category.value;
    const owner = form.owner.value;
    const owners = owner === '*' ? trip.travelers : [owner || null];
    const base = E.slug(name);
    const ops = owners.map((o) => ({ op: 'add', item: { id: base + (o ? '--' + o : '') + '-' + uid(), name, category, qty: 1, owner: o, custom: true } }));
    form.name.value = '';
    form.name.focus();
    await tripOps(tripId, ops);
    current.refresh && current.refresh();
    const type = typeById(trip.typeId);
    if (type) {
      toast(`Added ${name}`, {
        label: `Always pack for ${type.name}`,
        run: () => rememberItem(type.id, { name, category, owner: owner === '*' ? '*' : owner }),
      });
    }
  }

  async function rememberItem(typeId, { name, category, owner }) {
    const type = clone(typeById(typeId));
    if (type.items.some((r) => E.slug(r.name) === E.slug(name))) return toast(`${name} is already on the ${type.name} list`);
    const rule = { id: E.slug(name), name, category, scope: 'shared' };
    if (owner === '*') rule.scope = 'each';
    else if (owner) { const m = member(owner); rule.scope = 'each'; rule.who = [m ? m.kind : 'adult']; }
    type.items.push(rule);
    try {
      const saved = await api('PUT', 'types/' + typeId, type);
      Object.assign(typeById(typeId), saved);
      toast(`🧠 Got it. ${name} will be on every ${type.name} list.`);
    } catch (e) { fail(e); }
  }

  function itemModal(tripId, itemId) {
    const trip = tripById(tripId);
    const i = trip.items.find((x) => x.id === itemId);
    if (!i) return;
    const travelers = travelersOf(trip);
    const type = typeById(trip.typeId);
    modal(`<h2>Edit item</h2>
      <div class="stack">
        <label class="field"><span>Item</span><input class="input" id="i-name" value="${esc(i.name)}" maxlength="120"></label>
        <div class="editor-grid">
          <label class="field"><span>How many</span><input class="input" type="number" min="1" max="999" id="i-qty" value="${i.qty}"></label>
          <label class="field"><span>For</span><select class="input" id="i-owner"><option value="">🧺 Shared</option>
            ${travelers.map((m) => `<option value="${m.id}" ${i.owner === m.id ? 'selected' : ''}>${esc(m.emoji + ' ' + m.name)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span>Category</span><select class="input" id="i-cat">
          ${E.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === i.category ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Note</span><input class="input" id="i-note" value="${esc(i.note)}" maxlength="300" placeholder="e.g. the blue one"></label>
        ${i.custom && type ? `<button class="btn small ghost" id="i-remember" style="align-self:flex-start">🧠 Always pack this for ${esc(type.name)} trips</button>` : ''}
        ${i.custom && i.owner && member(i.owner) ? `<button class="btn small ghost" id="i-remember-p" style="align-self:flex-start">🧠 Always pack this for ${esc(member(i.owner).name)}, on every trip</button>` : ''}
      </div>
      <div class="modal-actions" style="justify-content:space-between">
        <div class="row"><button class="btn danger ghost" id="i-del">Delete</button>
          <button class="btn ghost" id="i-skip">${i.skipped ? 'Bring it after all' : 'Not this time'}</button></div>
        <div class="row"><button class="btn" data-close>Cancel</button><button class="btn primary" id="i-save">Save</button></div>
      </div>`, (m, close) => {
      $('#i-save', m).onclick = async () => {
        const fields = {
          name: $('#i-name', m).value.trim() || i.name, qty: Number($('#i-qty', m).value) || 1,
          owner: $('#i-owner', m).value || null, category: $('#i-cat', m).value, note: $('#i-note', m).value,
        };
        fields.qtyEdited = i.qtyEdited || fields.qty !== i.qty;
        fields.nameEdited = i.nameEdited || fields.name !== i.name;
        close();
        await tripOps(tripId, [{ op: 'update', itemId, fields }]);
        current.refresh && current.refresh();
      };
      $('#i-skip', m).onclick = async () => { close(); await tripOps(tripId, [{ op: 'skip', itemId, skipped: !i.skipped }]); current.refresh && current.refresh(); };
      $('#i-del', m).onclick = async () => {
        close();
        const copy = clone(i);
        await tripOps(tripId, [{ op: 'remove', itemId }]);
        current.refresh && current.refresh();
        toast(`Removed ${copy.name}`, { label: 'Undo', run: async () => { await tripOps(tripId, [{ op: 'add', item: copy }]); current.refresh && current.refresh(); } });
      };
      const remP = $('#i-remember-p', m);
      if (remP) remP.onclick = async () => {
        close();
        const who = member(i.owner);
        if ((who.always || []).some((a) => E.slug(a) === E.slug(i.name))) return toast(`${i.name} is already on ${who.name}'s list`);
        const next = S.members.map((x) => (x.id === who.id ? Object.assign({}, x, { always: [...(x.always || []), i.name] }) : x));
        try { S.members = (await api('PUT', 'members', { members: next })).members; toast(`🧠 Got it. ${i.name} will be packed for ${who.name} on every trip.`); } catch (e) { fail(e); }
      };
      const rem = $('#i-remember', m);
      if (rem) rem.onclick = () => { close(); rememberItem(type.id, { name: i.name, category: i.category, owner: i.owner }); };
    });
  }

  function tripMenu(anchor, tripId) {
    const trip = tripById(tripId);
    document.querySelectorAll('.menu').forEach((x) => x.remove());
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = `
      <button data-a="edit">✏️ Edit details & answers</button>
      <button data-a="print">🖨️ Print list</button>
      <button data-a="copy">📋 Copy as text</button>
      <button data-a="reset">↩️ Untick everything</button>
      <hr>
      <button data-a="review">${trip.archived ? '📦 Move back to upcoming' : '🏁 Trip done: review & learn'}</button>
      <button data-a="delete" style="color:var(--danger)">🗑️ Delete trip</button>`;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.top = r.bottom + window.scrollY + 6 + 'px';
    menu.style.left = Math.max(8, r.right + window.scrollX - menu.offsetWidth) + 'px';
    const close = () => { menu.remove(); document.removeEventListener('mousedown', outside); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    setTimeout(() => document.addEventListener('mousedown', outside));
    menu.onclick = async (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (!a) return;
      close();
      if (a === 'edit') location.hash = `#/trip/${tripId}/edit`;
      if (a === 'print') window.print();
      if (a === 'copy') copyText(trip);
      if (a === 'reset') {
        if (await confirmBox('Untick everything?', 'Handy for re-packing on the way home.', 'Untick all')) {
          await tripOps(tripId, [{ op: 'uncheckAll' }]); current.refresh && current.refresh();
        }
      }
      if (a === 'review') {
        if (trip.archived) { await api('PUT', 'trips/' + tripId, { archived: false }).then((t) => Object.assign(trip, t)).catch(fail); toast('Moved back to upcoming'); }
        else location.hash = `#/trip/${tripId}/review`;
      }
      if (a === 'delete') {
        if (await confirmBox('Delete this trip?', `"${trip.name}" and its packing list will be gone for good.`, 'Delete trip', true)) {
          await api('DELETE', 'trips/' + tripId).catch(fail);
          S.trips = S.trips.filter((t) => t.id !== tripId);
          location.hash = '#/';
          toast('Trip deleted');
        }
      }
    };
  }

  function copyText(trip) {
    const lines = [`${trip.name} (${dateRange(trip)})`, ''];
    E.CATEGORIES.forEach((c) => {
      const items = trip.items.filter((i) => i.category === c.id && !i.skipped);
      if (!items.length) return;
      lines.push(`${c.icon} ${c.label}`);
      items.forEach((i) => {
        const m = i.owner && member(i.owner);
        lines.push(`${i.checked ? '☑' : '☐'} ${i.name}${i.qty > 1 ? ' ×' + i.qty : ''}${m ? ' (' + m.name + ')' : ''}`);
      });
      lines.push('');
    });
    const text = lines.join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('📋 Copied! Paste it anywhere.'))
      .catch(() => modal(`<h2>Your list</h2><textarea class="input" style="min-height:300px">${esc(text)}</textarea><div class="modal-actions"><button class="btn" data-close>Close</button></div>`));
  }

  // ================================================================ REVIEW
  function viewReview(id) {
    const trip = tripById(id);
    if (!trip) return (location.hash = '#/');
    const type = typeById(trip.typeId);
    const essentials = core();
    // One row per rule (not per person).
    const seen = new Map();
    trip.items.filter((i) => !i.custom && i.rule && i.from !== 'profile').forEach((i) => { if (!seen.has(i.from + ':' + i.rule)) seen.set(i.from + ':' + i.rule, i); });
    const ruleItems = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
    const customs = [];
    const cseen = new Set();
    trip.items.filter((i) => i.custom).forEach((i) => { const k = E.slug(i.name); if (!cseen.has(k) && !(type && type.items.some((r) => E.slug(r.name) === k))) { cseen.add(k); customs.push(i); } });
    const unpacked = new Set(ruleItems.filter((i) => trip.items.filter((x) => x.rule === i.rule && x.from === i.from).every((x) => !x.checked || x.skipped)).map((i) => i.from + ':' + i.rule));

    app.innerHTML = `<div class="wizard">
      <a href="#/trip/${id}" class="btn ghost small" style="margin-bottom:12px">← Back to the list</a>
      <h1>How did ${esc(trip.name)} go? 🏁</h1>
      <p class="muted" style="margin-top:8px">Teach Pack Pal what to change, so the next ${esc(type ? type.name : '')} list is even better.</p>

      ${customs.length ? `<div class="section-title"><h2>Things you added</h2></div>
        <div class="list">${customs.map((i) => `<label class="review-item"><input type="checkbox" class="r-keep" data-name="${esc(i.name)}" data-cat="${esc(i.category)}" data-owner="${esc(i.owner || '')}" checked style="width:20px;height:20px;accent-color:var(--brand)">
          <span class="item-name">${esc(i.name)}</span><span class="faint small">add to future ${esc(type ? type.name : '')} trips</span></label>`).join('')}</div>` : ''}

      <div class="section-title"><h2>Forgot anything?</h2></div>
      <div class="card stack">
        <textarea class="input" id="r-forgot" placeholder="One per line, e.g.&#10;Kids' rain boots&#10;Extra phone cable"></textarea>
        <label class="field"><span>Put them under</span><select class="input" id="r-cat">${E.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === 'misc' ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}</select></label>
      </div>

      <div class="section-title"><h2>Didn't need it?</h2><span class="faint small">Items nobody packed are listed first</span></div>
      <p class="muted small" style="margin:-6px 0 12px">Tick anything you'd rather leave off next time. It will be removed from the list it came from.</p>
      <div class="list">${ruleItems.sort((a, b) => unpacked.has(b.from + ':' + b.rule) - unpacked.has(a.from + ':' + a.rule)).map((i) => {
        const src = i.from === (essentials && essentials.id) ? 'Everyday essentials' : (type ? type.name : '');
        const notPacked = unpacked.has(i.from + ':' + i.rule) ? '<span class="chip" style="font-size:.7rem;padding:2px 8px">not packed</span>' : '';
        return `<label class="review-item"><input type="checkbox" class="r-drop" data-from="${esc(i.from)}" data-rule="${esc(i.rule)}" data-name="${esc(i.name)}" style="width:20px;height:20px;accent-color:var(--danger)">
          <span class="item-name">${esc(i.name)}</span>${notPacked}<span class="faint small">${esc(src)}</span></label>`;
      }).join('')}</div>

      <div class="wizard-nav"><a class="btn ghost" href="#/trip/${id}">Not now</a>
        <button class="btn primary big" id="r-go">💾 Save & finish trip</button></div>
    </div>`;

    $('#r-go').onclick = async () => {
      const add = $$('.r-keep:checked').map((x) => ({ name: x.dataset.name, category: x.dataset.cat, owner: x.dataset.owner }));
      $('#r-forgot').value.split('\n').map((s) => s.trim()).filter(Boolean).forEach((name) => add.push({ name, category: $('#r-cat').value, owner: '' }));
      const drops = $$('.r-drop:checked').map((x) => ({ from: x.dataset.from, rule: x.dataset.rule, name: x.dataset.name }));
      try {
        const changed = new Map();
        const get = (tid) => { if (!changed.has(tid)) changed.set(tid, clone(typeById(tid))); return changed.get(tid); };
        drops.forEach((d) => { const t = typeById(d.from) && get(d.from); if (t) t.items = t.items.filter((r) => (r.id || E.slug(r.name)) !== d.rule); });
        if (type) {
          const t = get(type.id);
          add.forEach(({ name, category, owner }) => {
            if (t.items.some((r) => E.slug(r.name) === E.slug(name))) return;
            const rule = { id: E.slug(name), name, category, scope: 'shared' };
            if (owner) { rule.scope = 'each'; const m = member(owner); rule.who = [m ? m.kind : 'adult']; }
            t.items.push(rule);
          });
        }
        for (const [tid, t] of changed) Object.assign(typeById(tid), await api('PUT', 'types/' + tid, t));
        Object.assign(trip, await api('PUT', 'trips/' + id, { archived: true, reviewed: true }));
        location.hash = '#/';
        toast(`🧠 Lists updated: ${add.length} added, ${drops.length} removed. Welcome home!`);
      } catch (e) { fail(e); }
    };
  }

  // ================================================================ TRIP TYPES
  function viewTypes() {
    const ess = core();
    const types = S.types.filter((t) => !t.essentials);
    const uses = (id) => S.trips.filter((t) => t.typeId === id).length;
    app.innerHTML = `
      <div class="spread"><div><h1>Trip types</h1><p class="muted" style="margin-top:6px">Each type has its own questions and packing rules. Pack Pal learns as you go.</p></div>
        <button class="btn primary" id="ty-new">＋ New trip type</button></div>
      ${ess ? `<a class="card trip-card" href="#/types/${ess.id}" style="--c:${ess.color};margin-top:24px">
        <div class="row" style="flex-wrap:nowrap"><div class="trip-icon">${ess.icon}</div>
        <div style="flex:1"><h3>${esc(ess.name)}</h3><p class="muted small">${esc(ess.description)}</p></div>
        <span class="chip count">${plural(ess.items.length, 'item')}</span></div></a>` : ''}
      <div class="grid cards" style="margin-top:16px">
        ${types.map((t) => `<a class="card trip-card" href="#/types/${t.id}" style="--c:${t.color}">
          <div class="row" style="flex-wrap:nowrap"><div class="trip-icon">${t.icon}</div>
          <div style="flex:1;min-width:0"><h3>${esc(t.name)}</h3><p class="muted small">${esc(t.description)}</p></div></div>
          <div class="row small"><span class="chip">${plural(t.questions.length, 'question')}</span><span class="chip">${plural(t.items.length, 'item')}</span>
          ${uses(t.id) ? `<span class="chip count">used ${plural(uses(t.id), 'time')}</span>` : ''}</div></a>`).join('')}
      </div>`;
    $('#ty-new').onclick = newTypeModal;
  }

  const ICONS = ['🎿', '🧗', '🏄', '🥾', '🚵', '⛺', '🏖️', '🚗', '✈️', '🏡', '🏙️', '💼', '🚢', '🛶', '🎣', '🏕️', '🚴', '🏂', '⛷️', '🌋', '🏝️', '🎪', '⚽', '🎢', '🏟️', '🧳', '🐴', '🦌', '🌲', '🗻'];
  const COLORS = ['#0ea5e9', '#16a34a', '#a16207', '#6366f1', '#334155', '#db2777', '#ea580c', '#7c3aed', '#e11d48', '#0891b2', '#c2410c', '#65a30d', '#0f766e', '#64748b'];

  function newTypeModal() {
    const types = S.types.filter((t) => !t.essentials);
    modal(`<h2>New trip type</h2><div class="stack">
      <label class="field"><span>Name</span><input class="input" id="n-name" placeholder="e.g. Canoe trip" maxlength="60"></label>
      <label class="field"><span>Start from</span><select class="input" id="n-from"><option value="">A blank list</option>
        ${types.map((t) => `<option value="${t.id}">A copy of ${esc(t.icon + ' ' + t.name)}</option>`).join('')}</select></label>
      </div><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="n-go">Create</button></div>`, (m, close) => {
      $('#n-go', m).onclick = async () => {
        const name = $('#n-name', m).value.trim();
        if (!name) return toast('Give it a name');
        const from = typeById($('#n-from', m).value);
        const body = from ? Object.assign(clone(from), { name, description: `Based on ${from.name}.` })
          : { name, icon: '🧳', color: COLORS[Math.floor(Math.random() * COLORS.length)], description: '', questions: [], items: [] };
        try {
          const t = await api('POST', 'types', body);
          S.types.push(t);
          close();
          location.hash = '#/types/' + t.id;
        } catch (e) { fail(e); }
      };
    });
  }

  const DERIVED = [
    { id: 'nights', text: 'Number of nights', type: 'number' },
    { id: 'kids', text: 'Kids are coming', type: 'yesno' },
    { id: 'baby', text: 'A baby is coming', type: 'yesno' },
  ];

  function viewTypeEditor(id) {
    const orig = typeById(id);
    if (!orig) return (location.hash = '#/types');
    const draft = clone(orig);
    const isDefault = ['essentials', 'ski', 'climbing', 'paddleboard', 'hiking', 'mtb', 'camping', 'beach', 'roadtrip', 'family', 'international', 'city', 'business', 'cruise'].includes(id);
    const open = new Set();
    const markDirty = () => { current.dirty = true; $('#te-save').disabled = false; preview(); };

    const allQuestions = () => [...(draft.essentials ? [] : (core() ? core().questions : [])), ...draft.questions, ...DERIVED];

    app.innerHTML = `
      <a href="#/types" class="btn ghost small" style="margin-bottom:12px">← Trip types</a>
      <div class="trip-head" style="--c:${draft.color}" id="te-head"></div>
      <div class="section-title"><h2>Basics</h2></div>
      <div class="card stack" id="te-basics"></div>
      <div class="section-title"><h2>Questions</h2><button class="btn small" id="te-addq">＋ Add question</button></div>
        <p class="muted small" style="margin:-6px 0 12px">${draft.essentials
          ? 'Asked on every trip. Yes/no questions marked "easy-to-forget check" all appear together on one quick screen at the end.'
          : 'Asked when you plan this kind of trip. Use the answers in item rules below. The questions from Everyday essentials, including the easy-to-forget check, are always asked too.'}</p>
        <div id="te-qs"></div>
      <div class="section-title"><h2>What to pack</h2><button class="btn small" id="te-additem">＋ Add item</button></div>
      <p class="muted small" style="margin:-6px 0 12px">Click an item to set who it's for, how many, and when to include it.</p>
      <div id="te-items"></div>
      <div class="row" style="margin-top:28px">
        ${isDefault ? '<button class="btn ghost" id="te-restore">↺ Restore original</button>' : ''}
        ${draft.essentials ? '' : '<button class="btn ghost danger" id="te-del">🗑️ Delete trip type</button>'}
      </div>
      <div class="preview-strip"><span id="te-prev" class="small"></span>
        <div class="row"><button class="btn small ghost" id="te-discard" style="color:inherit">Discard</button><button class="btn small primary" id="te-save" disabled>Save changes</button></div></div>`;

    function head() {
      $('#te-head').style.setProperty('--c', draft.color);
      $('#te-head').innerHTML = `<div class="trip-icon">${esc(draft.icon)}</div><div><h1 style="font-size:clamp(1.6rem,4vw,2.2rem)">${esc(draft.name)}</h1><p class="muted">${esc(draft.description)}</p></div>`;
    }

    function basics() {
      $('#te-basics').innerHTML = `
        <div class="editor-grid">
          <label class="field"><span>Name</span><input class="input" id="b-name" value="${esc(draft.name)}" maxlength="60"></label>
          <label class="field"><span>Short description</span><input class="input" id="b-desc" value="${esc(draft.description)}" maxlength="200"></label>
        </div>
        <div class="field"><span>Icon</span><div class="emoji-picks">${ICONS.map((i) => `<button data-i="${i}" class="${i === draft.icon ? 'on' : ''}">${i}</button>`).join('')}
          <input class="input sm" id="b-icon" value="${esc(draft.icon)}" style="width:70px;text-align:center" aria-label="Custom emoji"></div></div>
        <div class="field"><span>Color</span><div class="swatches">${COLORS.map((c) => `<button class="swatch ${c === draft.color ? 'on' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>`;
      $('#b-name').oninput = (e) => { draft.name = e.target.value; head(); markDirty(); };
      $('#b-desc').oninput = (e) => { draft.description = e.target.value; head(); markDirty(); };
      $('#b-icon').oninput = (e) => { draft.icon = e.target.value; head(); markDirty(); };
      $$('.emoji-picks button').forEach((b) => (b.onclick = () => { draft.icon = b.dataset.i; basics(); head(); markDirty(); }));
      $$('.swatch').forEach((b) => (b.onclick = () => { draft.color = b.dataset.c; basics(); head(); markDirty(); }));
    }

    function questions() {
      const root = $('#te-qs');
      if (!root) return;
      if (!draft.questions.length) { root.innerHTML = '<div class="card muted small">No questions yet.</div>'; return; }
      root.innerHTML = draft.questions.map((q, qi) => `<div class="q-card" data-qi="${qi}">
        <div class="row" style="flex-wrap:nowrap"><input class="input q-text" value="${esc(q.text)}" placeholder="Question">
          <select class="input q-type" style="width:auto">
            ${[['yesno', 'Yes / no'], ['choice', 'Pick one'], ['multi', 'Pick several'], ['number', 'Number']].map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
          <button class="icon-btn q-up" title="Move up">↑</button><button class="icon-btn q-del" title="Delete question">✕</button></div>
        ${q.type === 'choice' || q.type === 'multi' ? `<div class="row" style="margin-top:10px">${(q.options || []).map((o, oi) => `<span class="chip">${esc(o.label)} <button class="icon-btn q-odel" data-oi="${oi}" style="width:20px;height:20px;font-size:.7rem">✕</button></span>`).join('')}
          <input class="input sm q-onew" placeholder="Add an answer, press Enter" style="width:220px"></div>` : ''}
        ${q.type === 'yesno' ? `<label class="check small" style="margin-top:8px"><input type="checkbox" class="q-group" ${q.group === 'forgot' ? 'checked' : ''}> Part of the easy-to-forget check</label>` : ''}
      </div>`).join('');
      $$('.q-card', root).forEach((card) => {
        const q = draft.questions[Number(card.dataset.qi)];
        $('.q-text', card).oninput = (e) => { q.text = e.target.value; markDirty(); };
        $('.q-type', card).onchange = (e) => { q.type = e.target.value; if (q.type !== 'yesno') delete q.group; if ((q.type === 'choice' || q.type === 'multi') && !q.options) q.options = []; questions(); markDirty(); };
        const grp = $('.q-group', card);
        if (grp) grp.onchange = (e) => { if (e.target.checked) q.group = 'forgot'; else delete q.group; markDirty(); };
        $('.q-del', card).onclick = () => { draft.questions.splice(Number(card.dataset.qi), 1); questions(); items(); markDirty(); };
        $('.q-up', card).onclick = () => { const i = Number(card.dataset.qi); if (i > 0) { [draft.questions[i - 1], draft.questions[i]] = [draft.questions[i], draft.questions[i - 1]]; questions(); markDirty(); } };
        $$('.q-odel', card).forEach((b) => (b.onclick = () => { q.options.splice(Number(b.dataset.oi), 1); questions(); markDirty(); }));
        const onew = $('.q-onew', card);
        if (onew) onew.onkeydown = (e) => {
          if (e.key !== 'Enter' || !onew.value.trim()) return;
          e.preventDefault();
          q.options.push({ value: E.slug(onew.value) || uid(), label: onew.value.trim() });
          questions(); markDirty();
          $(`.q-card[data-qi="${draft.questions.indexOf(q)}"] .q-onew`).focus();
        };
      });
    }

    function ruleTags(r) {
      const tags = [];
      tags.push(r.scope === 'each' ? '👤 each person' : '🧺 shared');
      if (r.who && r.who.length) tags.push(r.who.map((w) => ({ adult: 'adults', kid: 'kids', baby: 'babies', pet: 'pets' }[w])).join(' & '));
      if (r.needs && r.needs.length) tags.push('🧠 from family profile');
      const q = r.qty || {};
      if (q.perDay || q.perNight) tags.push('scales with nights');
      else if ((q.base || 1) > 1) tags.push('×' + q.base);
      if (r.when && Object.keys(r.when).length) tags.push('🔀 ' + plural(Object.keys(r.when).length, 'condition'));
      const qIds = new Set([...allQuestions().map((q) => q.id), 'days', 'travelers', 'pet']);
      if (Object.keys(r.when || {}).some((q) => !qIds.has(q))) tags.push('⚠️ uses a deleted question (ignored)');
      return tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('');
    }

    function items() {
      const root = $('#te-items');
      const groups = E.CATEGORIES.map((c) => ({ c, rules: draft.items.map((r, i) => ({ r, i })).filter(({ r }) => (E.CATEGORIES.some((x) => x.id === r.category) ? r.category : 'misc') === c.id) })).filter((g) => g.rules.length);
      if (!groups.length) { root.innerHTML = '<div class="card empty"><div class="big-emoji">📦</div><p class="muted">No items yet. Add the first one.</p></div>'; return; }
      root.innerHTML = groups.map(({ c, rules }) => `<section class="group"><div class="group-head"><span style="font-size:1.2rem">${c.icon}</span><h3>${esc(c.label)}</h3><span class="faint">${rules.length}</span></div>
        <div class="list">${rules.map(({ r, i }) => `<div class="rule" data-i="${i}">
          <div class="rule-summary"><span class="item-name">${esc(r.name)}</span><span class="rule-tags">${ruleTags(r)}</span><span class="faint">${open.has(i) ? '▴' : '▾'}</span></div>
          ${open.has(i) ? ruleBody(r) : ''}</div>`).join('')}</div></section>`).join('');
      $$('.rule', root).forEach((el) => {
        const i = Number(el.dataset.i);
        $('.rule-summary', el).onclick = () => { open.has(i) ? open.delete(i) : open.add(i); items(); };
        if (open.has(i)) bindRule(el, draft.items[i], i);
      });
    }

    function valueControl(q, expected, ci) {
      if (q.id === 'nights' || q.type === 'number') {
        const v = expected && typeof expected === 'object' && !Array.isArray(expected) ? expected.gte ?? 0 : 0;
        return `<span class="small muted">at least</span><input class="input sm c-gte" data-ci="${ci}" type="number" min="0" value="${v}" style="width:80px">`;
      }
      const opts = q.type === 'yesno' ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] : (q.options || []);
      const want = Array.isArray(expected) ? expected : [expected];
      return `<span class="small muted">is</span>` + opts.map((o) => `<span class="chip toggle c-opt ${want.includes(o.value) ? 'on' : ''}" data-ci="${ci}" data-v="${esc(o.value)}">${esc(o.label)}</span>`).join('');
    }

    function ruleBody(r) {
      const q = r.qty || {};
      const conds = Object.entries(r.when || {});
      const qs = allQuestions();
      return `<div class="rule-body stack">
        <div class="editor-grid">
          <label class="field"><span>Name</span><input class="input sm r-name" value="${esc(r.name)}"></label>
          <label class="field"><span>Category</span><select class="input sm r-cat">${E.CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === r.category ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <div class="seg r-scope"><button data-s="each" class="${r.scope === 'each' ? 'on' : ''}">👤 One for each person</button><button data-s="shared" class="${r.scope !== 'each' ? 'on' : ''}">🧺 Shared</button></div>
          <span class="small muted">${r.scope === 'each' ? 'for' : 'only if coming:'}</span>
          ${['adult', 'kid', 'baby', 'pet'].map((w) => `<span class="chip toggle r-who ${(r.who || []).includes(w) ? 'on' : ''}" data-w="${w}">${{ adult: '🧑 Adults', kid: '🧒 Kids', baby: '👶 Babies', pet: '🐾 Pets' }[w]}</span>`).join('')}
          <span class="faint small">${!(r.who || []).length ? '(none picked = all people)' : ''}</span>
        </div>
        <div class="row" style="gap:6px"><span class="small muted">Only for those who have:</span>
          ${[...E.NEEDS, { id: 'dog', icon: '🐶', label: 'Dogs' }, { id: 'cat', icon: '🐱', label: 'Cats' }].map((n) => `<span class="chip toggle r-need ${(r.needs || []).includes(n.id) ? 'on' : ''}" data-n="${n.id}">${n.icon} ${esc(n.label)}</span>`).join('')}
        </div>
        <div><div class="small muted" style="margin-bottom:6px;font-weight:600">How many${r.scope === 'each' ? ' (per person)' : ''}</div>
          <div class="qty-row">
            <label class="field"><span class="small">Base</span><input class="input sm r-q" data-k="base" type="number" min="0" step="1" value="${q.base ?? ''}" placeholder="1"></label>
            <label class="field"><span class="small">+ per day</span><input class="input sm r-q" data-k="perDay" type="number" min="0" step="0.25" value="${q.perDay ?? ''}" placeholder="0"></label>
            <label class="field"><span class="small">+ per night</span><input class="input sm r-q" data-k="perNight" type="number" min="0" step="0.25" value="${q.perNight ?? ''}" placeholder="0"></label>
            <label class="field"><span class="small">Max</span><input class="input sm r-q" data-k="max" type="number" min="0" value="${q.max ?? ''}" placeholder="none"></label>
          </div>
          <label class="check small" style="margin-top:8px"><input type="checkbox" class="r-laundry" ${q.laundry ? 'checked' : ''}> Pack fewer when there's laundry</label>
        </div>
        <div><div class="small muted" style="font-weight:600">Only include when...</div>
          ${conds.length ? '' : '<div class="small faint" style="margin-top:6px">Always included.</div>'}
          ${conds.map(([qid, exp], ci) => {
            const qq = qs.find((x) => x.id === qid) || { id: qid, text: qid, type: 'yesno' };
            return `<div class="cond"><select class="input sm c-q" data-ci="${ci}" style="width:auto;max-width:280px">
              ${qs.map((x) => `<option value="${esc(x.id)}" ${x.id === qid ? 'selected' : ''}>${esc(x.text)}</option>`).join('')}
              ${qs.some((x) => x.id === qid) ? '' : `<option value="${esc(qid)}" selected>${esc(qid)} (missing)</option>`}</select>
              ${valueControl(qq, exp, ci)}<button class="icon-btn c-del" data-ci="${ci}" title="Remove condition">✕</button></div>`;
          }).join('')}
          <button class="btn small ghost c-add" style="margin-top:6px">＋ Add condition</button>
        </div>
        <label class="field"><span>Tip / note</span><input class="input sm r-note" value="${esc(r.note || '')}" placeholder="Shown under the item"></label>
        <div class="row"><button class="btn small ghost danger r-del">Delete item</button></div>
      </div>`;
    }

    function bindRule(el, r, i) {
      const redraw = () => { items(); markDirty(); };
      $('.r-name', el).oninput = (e) => { r.name = e.target.value; $('.item-name', el).textContent = r.name; markDirty(); };
      $('.r-cat', el).onchange = (e) => { r.category = e.target.value; redraw(); };
      $('.r-note', el).oninput = (e) => { r.note = e.target.value; markDirty(); };
      $$('.r-scope button', el).forEach((b) => (b.onclick = () => { r.scope = b.dataset.s; redraw(); }));
      $$('.r-need', el).forEach((b) => (b.onclick = () => {
        const n = b.dataset.n; r.needs = r.needs || [];
        r.needs = r.needs.includes(n) ? r.needs.filter((x) => x !== n) : [...r.needs, n];
        if (!r.needs.length) delete r.needs;
        redraw();
      }));
      $$('.r-who', el).forEach((b) => (b.onclick = () => {
        const w = b.dataset.w; r.who = r.who || [];
        r.who = r.who.includes(w) ? r.who.filter((x) => x !== w) : [...r.who, w];
        if (!r.who.length) delete r.who;
        redraw();
      }));
      $$('.r-q', el).forEach((inp) => (inp.oninput = () => {
        r.qty = r.qty || {};
        if (inp.value === '') delete r.qty[inp.dataset.k]; else r.qty[inp.dataset.k] = Number(inp.value);
        markDirty();
      }));
      $('.r-laundry', el).onchange = (e) => { r.qty = r.qty || {}; r.qty.laundry = e.target.checked; markDirty(); };
      const keys = () => Object.keys(r.when || {});
      $$('.c-q', el).forEach((s) => (s.onchange = () => {
        const old = keys()[Number(s.dataset.ci)];
        const entries = Object.entries(r.when).map(([k, v]) => (k === old ? [s.value, defaultCond(s.value)] : [k, v]));
        r.when = Object.fromEntries(entries);
        redraw();
      }));
      $$('.c-opt', el).forEach((c) => (c.onclick = () => {
        const k = keys()[Number(c.dataset.ci)];
        let cur = r.when[k]; cur = Array.isArray(cur) ? cur : (cur && typeof cur === 'object' ? [] : [cur]);
        const v = c.dataset.v;
        cur = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
        r.when[k] = cur.length === 1 ? cur[0] : cur;
        redraw();
      }));
      $$('.c-gte', el).forEach((inp) => (inp.oninput = () => { r.when[keys()[Number(inp.dataset.ci)]] = { gte: Number(inp.value) || 0 }; markDirty(); }));
      $$('.c-del', el).forEach((b) => (b.onclick = () => { delete r.when[keys()[Number(b.dataset.ci)]]; if (!keys().length) delete r.when; redraw(); }));
      $('.c-add', el).onclick = () => {
        const used = new Set(keys());
        const q = allQuestions().find((x) => !used.has(x.id));
        if (!q) return toast('Every question is already used');
        r.when = Object.assign(r.when || {}, { [q.id]: defaultCond(q.id) });
        redraw();
      };
      $('.r-del', el).onclick = () => { draft.items.splice(i, 1); open.clear(); redraw(); };
    }

    function defaultCond(qid) {
      const q = allQuestions().find((x) => x.id === qid);
      if (!q) return 'yes';
      if (q.type === 'number' || qid === 'nights') return { gte: 1 };
      if (q.type === 'yesno') return 'yes';
      return (q.options && q.options[0] && q.options[0].value) || '';
    }

    function preview() {
      // Show what a typical trip would look like with the current family.
      const fam = S.members.length ? S.members : [{ id: 'a', name: 'Adult', kind: 'adult' }, { id: 'b', name: 'Adult', kind: 'adult' }];
      const answers = Object.assign({}, core() ? core().defaults : {}, draft.defaults || {});
      draft.questions.forEach((q) => { if (answers[q.id] === undefined) answers[q.id] = q.type === 'yesno' ? 'yes' : q.type === 'number' ? 1 : (q.options || []).map((o) => o.value); });
      const list = E.generate({ core: draft.essentials ? null : core(), type: draft, trip: { nights: 3, answers, includeEssentials: true }, travelers: fam });
      $('#te-prev').textContent = `Preview: 3 nights, ${plural(fam.length, 'person', 'people')}, answering yes to everything → ${plural(list.length, 'item')} to pack`;
    }

    head(); basics(); questions(); items(); preview();

    const addq = $('#te-addq');
    if (addq) addq.onclick = () => {
      draft.questions.push({ id: 'q' + uid(), text: 'New question?', type: 'yesno' });
      questions(); markDirty();
      const all = $$('.q-text'); all[all.length - 1].select();
    };
    $('#te-additem').onclick = () => {
      draft.items.push({ id: 'item-' + uid(), name: 'New item', category: 'misc', scope: 'shared' });
      open.clear(); open.add(draft.items.length - 1);
      items(); markDirty();
      const el = $(`.rule[data-i="${draft.items.length - 1}"]`);
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      $('.r-name', el).select();
    };
    $('#te-save').onclick = async () => {
      if (!draft.name.trim()) return toast('Give it a name');
      draft.items.forEach((r) => { if (!r.id || r.id.startsWith('item-')) r.id = E.slug(r.name) || r.id; });
      try {
        const saved = await api('PUT', 'types/' + id, draft);
        Object.assign(orig, saved);
        current.dirty = false;
        $('#te-save').disabled = true;
        toast('✅ Saved. New trips will use these rules.');
      } catch (e) { fail(e); }
    };
    $('#te-discard').onclick = () => { current.dirty = false; viewTypeEditor(id); };
    const del = $('#te-del');
    if (del) del.onclick = async () => {
      if (!(await confirmBox(`Delete ${draft.name}?`, 'Trips you already planned keep their lists.', 'Delete', true))) return;
      try { await api('DELETE', 'types/' + id); S.types = S.types.filter((t) => t.id !== id); current.dirty = false; location.hash = '#/types'; toast('Deleted'); } catch (e) { fail(e); }
    };
    const restore = $('#te-restore');
    if (restore) restore.onclick = async () => {
      if (!(await confirmBox('Restore the original?', 'This replaces your changes to this trip type with the original version.', 'Restore'))) return;
      try { Object.assign(orig, await api('POST', 'types/restore', { id })); current.dirty = false; viewTypeEditor(id); toast('Restored'); } catch (e) { fail(e); }
    };
  }

  // ================================================================ FAMILY
  const PEOPLE_EMOJI = ['🧔', '👩', '👨', '🧑', '👧', '👦', '👶', '👵', '👴', '🧒', '🐶', '🐱', '🦊', '🐻', '🐼', '🦄', '🐸', '🐧', '🦖', '🌟'];
  const PEOPLE_COLORS = ['#0ea5e9', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444'];

  const PET_EMOJI = ['🐶', '🐕', '🐩', '🐱', '🐈', '🐰', '🐹', '🐦', '🐢', '🐴'];
  const SPECIES = [['dog', '🐶 Dog'], ['cat', '🐱 Cat'], ['other', '🐾 Other']];

  function memberModal(m, onSaved, kindHint) {
    const isNewPet = !m && kindHint === 'pet';
    const draft = m ? clone(m) : {
      id: uid(), name: '', kind: isNewPet ? 'pet' : 'adult', species: isNewPet ? 'dog' : undefined,
      emoji: isNewPet ? '🐶' : PEOPLE_EMOJI[S.members.length % PEOPLE_EMOJI.length],
      color: PEOPLE_COLORS[S.members.length % PEOPLE_COLORS.length], needs: [], always: [],
    };
    draft.needs = draft.needs || [];
    draft.always = draft.always || [];
    const pet = () => draft.kind === 'pet';
    modal(`<h2 id="m-title"></h2><div class="stack">
      <label class="field"><span>Name</span><input class="input" id="m-name" value="${esc(draft.name)}" maxlength="40" placeholder="e.g. Sam"></label>
      <div class="field"><span>Who are they?</span><div class="seg" id="m-kind" style="flex-wrap:wrap">
        ${[['adult', '🧑 Adult'], ['kid', '🧒 Kid'], ['baby', '👶 Baby'], ['pet', '🐾 Pet']].map(([v, l]) => `<button data-k="${v}" class="${draft.kind === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="faint small" style="font-weight:400" id="m-kindhelp"></span></div>
      <div class="field" id="m-species-f"><span>What kind of pet?</span><div class="seg" id="m-species">
        ${SPECIES.map(([v, l]) => `<button data-s="${v}" class="${draft.species === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="field" id="m-needs-f"><span>Remember for them on every trip</span><div class="row" id="m-needs" style="gap:6px">
        ${E.NEEDS.map((n) => `<span class="chip toggle ${draft.needs.includes(n.id) ? 'on' : ''}" data-n="${n.id}">${n.icon} ${esc(n.label)}</span>`).join('')}</div></div>
      <label class="field"><span id="m-always-l"></span>
        <textarea class="input" id="m-always" placeholder="One per line, e.g.&#10;Blue blankie&#10;Night-light&#10;Favorite pillow" style="min-height:80px">${esc(draft.always.join('\n'))}</textarea></label>
      <div class="field"><span>Avatar</span><div class="emoji-picks" id="m-emoji"></div></div>
      <div class="field"><span>Color</span><div class="swatches" id="m-color">${PEOPLE_COLORS.map((c) => `<button class="swatch ${draft.color === c ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}</div></div>
      </div><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn primary" id="m-save">Save</button></div>`, (el, close) => {
      const sync = () => {
        $('#m-title', el).textContent = `${m ? 'Edit' : 'Add'} ${pet() ? 'pet' : 'family member'}`;
        $('#m-kindhelp', el).textContent = {
          adult: 'Adults get the grown-up things (ID, wallet, phone).', kid: 'Kids get kid things (comfort toys, snacks, activities).',
          baby: 'Babies get diapers, wipes, sleepers and bottles.', pet: 'Pets get food, bowls and bedding, and only come when you pick them.',
        }[draft.kind];
        $('#m-species-f', el).classList.toggle('hidden', !pet());
        $('#m-needs-f', el).classList.toggle('hidden', pet());
        $('#m-always-l', el).textContent = 'Always pack for ' + ($('#m-name', el).value.trim() || (pet() ? 'this pet' : 'this person'));
        const picks = pet() ? PET_EMOJI : PEOPLE_EMOJI.filter((e) => !PET_EMOJI.includes(e));
        $('#m-emoji', el).innerHTML = picks.map((e) => `<button data-e="${e}" class="${draft.emoji === e ? 'on' : ''}">${e}</button>`).join('');
        $$('#m-emoji button', el).forEach((b) => (b.onclick = () => { draft.emoji = b.dataset.e; sync(); }));
      };
      sync();
      $('#m-name', el).addEventListener('input', sync);
      $$('#m-kind button', el).forEach((b) => (b.onclick = () => {
        const wasPet = pet();
        draft.kind = b.dataset.k;
        if (pet() && !draft.species) draft.species = 'dog';
        if (pet() !== wasPet) draft.emoji = pet() ? '🐶' : PEOPLE_EMOJI[0];
        $$('#m-kind button', el).forEach((x) => x.classList.toggle('on', x === b));
        sync();
      }));
      $$('#m-species button', el).forEach((b) => (b.onclick = () => { draft.species = b.dataset.s; $$('#m-species button', el).forEach((x) => x.classList.toggle('on', x === b)); }));
      $$('#m-needs .chip', el).forEach((c) => (c.onclick = () => {
        const n = c.dataset.n;
        draft.needs = draft.needs.includes(n) ? draft.needs.filter((x) => x !== n) : [...draft.needs, n];
        c.classList.toggle('on');
      }));
      $$('#m-color button', el).forEach((b) => (b.onclick = () => { draft.color = b.dataset.c; $$('#m-color button', el).forEach((x) => x.classList.toggle('on', x === b)); }));
      const save = async () => {
        draft.name = $('#m-name', el).value.trim();
        if (!draft.name) return toast('Add a name');
        draft.always = $('#m-always', el).value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (pet()) draft.needs = []; else delete draft.species;
        const next = m ? S.members.map((x) => (x.id === m.id ? draft : x)) : [...S.members, draft];
        try {
          const res = await api('PUT', 'members', { members: next });
          S.members = res.members;
          close();
          onSaved && onSaved(S.members.find((x) => x.id === draft.id));
        } catch (e) { fail(e); }
      };
      $('#m-save', el).onclick = save;
      $('#m-name', el).onkeydown = (e) => { if (e.key === 'Enter') save(); };
    });
  }

  function viewFamily() {
    const kindLabel = { adult: 'Adult', kid: 'Kid', baby: 'Baby', pet: 'Pet' };
    const speciesLabel = { dog: 'Dog', cat: 'Cat', other: 'Pet' };
    const details = (m) => {
      const bits = (m.needs || []).map((n) => E.NEEDS.find((x) => x.id === n)).filter(Boolean).map((n) => `<span class="chip" title="${esc(n.label)}">${n.icon} ${esc(n.label)}</span>`);
      if ((m.always || []).length) bits.push(`<span class="chip" title="${esc(m.always.join(', '))}">🧸 ${plural(m.always.length, 'must-bring')}</span>`);
      return bits.length ? `<div class="row" style="gap:6px;margin-top:8px">${bits.join('')}</div>` : (m.kind === 'pet' ? '' : '<p class="faint small" style="margin-top:6px">Tap ✏️ to add medication, glasses or must-brings.</p>');
    };
    app.innerHTML = `
      <div class="spread"><div><h1>Family</h1><p class="muted" style="margin-top:6px">Everyone who might come along. Tell Pack Pal once about medication, glasses and must-brings, and it remembers on every trip.</p></div>
        <div class="row"><button class="btn" id="f-pet">🐾 Add pet</button><button class="btn primary" id="f-add">＋ Add person</button></div></div>
      <div class="grid cards" style="margin-top:24px">
        ${S.members.map((m) => `<div class="card" style="display:flex;gap:12px;align-items:flex-start">${avatar(m, 52)}
          <div style="flex:1;min-width:0"><h3>${esc(m.name)}</h3><p class="muted small">${m.kind === 'pet' ? speciesLabel[m.species] || 'Pet' : kindLabel[m.kind]}${prefs.me === m.id ? ' · this device' : ''}</p>${details(m)}</div>
          <button class="icon-btn" data-edit="${m.id}" title="Edit">✏️</button><button class="icon-btn" data-del="${m.id}" title="Remove">✕</button></div>`).join('')}
        ${S.members.length ? '' : '<div class="card empty" style="grid-column:1/-1"><div class="big-emoji">👨‍👩‍👧‍👦</div><h3>No one here yet</h3><p class="muted small">Add yourself first, then the rest of the crew.</p></div>'}
      </div>

      <div class="section-title"><h2>This device</h2></div>
      <div class="card row">
        <span style="font-size:1.6rem">📱</span>
        <div style="flex:1"><b>Who uses this device?</b><p class="muted small">So the list can show who packed what.</p></div>
        <select class="input" id="f-me" style="width:auto"><option value="">Not set</option>
          ${S.members.filter(E.isPerson).map((m) => `<option value="${m.id}" ${prefs.me === m.id ? 'selected' : ''}>${esc(m.emoji + ' ' + m.name)}</option>`).join('')}</select>
      </div>

      <div class="section-title"><h2>Settings</h2></div>
      <div class="grid cards">
        <div class="card stack"><div style="font-size:1.6rem">💾</div><h3>Backup</h3>
          <p class="muted small">Download everything (trips, trip types, family) as one file. The app also keeps 14 days of automatic backups in its data folder.</p>
          <a class="btn" href="/api/export" download>Download backup</a></div>
        <div class="card stack"><div style="font-size:1.6rem">${S.passwordEnabled ? '🔒' : '🔓'}</div><h3>Password ${S.passwordEnabled ? 'is on' : 'is off'}</h3>
          <p class="muted small">${S.passwordEnabled ? 'Everyone needs the family password once on each device.' : 'Anyone who can reach this page can use it. Turn on a password before putting it on the internet. See the README for how.'}</p></div>
        <div class="card stack"><div style="font-size:1.6rem">📲</div><h3>Put it on your phone</h3>
          <p class="muted small">Open this page on your phone, then use "Add to Home Screen" (Safari share menu, or the Chrome ⋮ menu). It opens like an app.</p></div>
      </div>`;
    $('#f-pet').onclick = () => memberModal(null, viewFamily, 'pet');
    $('#f-add').onclick = () => memberModal(null, () => { if (!prefs.me && S.members.length === 1) { prefs.me = S.members[0].id; savePrefs(); } viewFamily(); });
    $$('[data-edit]').forEach((b) => (b.onclick = () => memberModal(member(b.dataset.edit), viewFamily)));
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      const m = member(b.dataset.del);
      if (!(await confirmBox(`Remove ${m.name}?`, 'Their items stay on trips you already planned.', 'Remove', true))) return;
      try { S.members = (await api('PUT', 'members', { members: S.members.filter((x) => x.id !== m.id) })).members; viewFamily(); } catch (e) { fail(e); }
    }));
    $('#f-me').onchange = (e) => { prefs.me = e.target.value || null; savePrefs(); viewFamily(); };
    current.refresh = viewFamily;
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      await load();
      connectLive();
      route();
    } catch (e) {
      if (e.message !== 'login') app.innerHTML = `<div class="card empty"><div class="big-emoji">🔌</div><h3>Can't reach Pack Pal</h3><p class="muted">${esc(e.message)}</p></div>`;
    }
  }
  boot();
})();
