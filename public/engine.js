/*
 * Packing engine: turns a trip type + answers + travelers into a packing list.
 * Shared by the browser (window.PackEngine) and Node tests (module.exports).
 *
 * Item rule format (stored in trip types, editable in the app):
 * {
 *   id, name, category, note?,
 *   scope: 'each' | 'shared',       // 'each' = one entry per matching traveler
 *   who?: ['adult','kid','baby'],   // which travelers it applies to (each), or requires (shared)
 *   qty?: { base, perNight, perDay, max, laundry }   // laundry: cap when laundry is available
 *   when?: { questionId: value | [values] | {gte,lte} }  // all must match
 * }
 */
(function (root) {
  const LAUNDRY_CAP = 4;

  const CATEGORIES = [
    { id: 'clothing', label: 'Clothing', icon: '👕' },
    { id: 'toiletries', label: 'Toiletries', icon: '🧴' },
    { id: 'health', label: 'Health & safety', icon: '🩹' },
    { id: 'documents', label: 'Documents & money', icon: '🪪' },
    { id: 'electronics', label: 'Electronics', icon: '🔌' },
    { id: 'gear', label: 'Gear', icon: '🎒' },
    { id: 'food', label: 'Food & kitchen', icon: '🥪' },
    { id: 'kids', label: 'Kids & baby', icon: '🧸' },
    { id: 'fun', label: 'Fun & comfort', icon: '🎲' },
    { id: 'misc', label: 'Everything else', icon: '📦' },
  ];

  function categoryOf(id) {
    return CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  }

  function nightsBetween(start, end) {
    if (!start || !end) return null;
    const a = Date.parse(start + 'T00:00:00Z');
    const b = Date.parse(end + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b)) return null;
    return Math.max(0, Math.round((b - a) / 86400000));
  }

  // Answers the engine always knows, derived from trip details.
  function derivedAnswers(trip, travelers) {
    const kinds = travelers.map((t) => t.kind);
    return {
      nights: trip.nights,
      days: trip.nights + 1,
      travelers: travelers.filter(isPerson).length,
      kids: kinds.includes('kid') ? 'yes' : 'no',
      baby: kinds.includes('baby') ? 'yes' : 'no',
      pet: kinds.includes('pet') ? 'yes' : 'no',
    };
  }

  const isPerson = (t) => t.kind !== 'pet';

  // Things the family has told Pack Pal about a person or pet: needs like
  // "glasses" or "meds", and for pets their species ("dog", "cat").
  const NEEDS = [
    { id: 'meds', label: 'Daily medication', icon: '💊' },
    { id: 'glasses', label: 'Glasses', icon: '👓' },
    { id: 'contacts', label: 'Contacts', icon: '👁️' },
    { id: 'allergy', label: 'Allergy meds / EpiPen', icon: '🤧' },
    { id: 'inhaler', label: 'Inhaler', icon: '🫁' },
    { id: 'retainer', label: 'Retainer / mouthguard', icon: '🦷' },
    { id: 'cpap', label: 'CPAP machine', icon: '😴' },
    { id: 'hearing', label: 'Hearing aids', icon: '🦻' },
  ];
  const traits = (t) => [...(t.needs || []), t.species].filter(Boolean);

  // Does this traveler get a per-person ("each") rule?
  function appliesTo(rule, t) {
    const who = rule.who && rule.who.length ? rule.who : null;
    if (who ? !who.includes(t.kind) : !isPerson(t)) return false; // pets only get rules made for pets
    if (rule.needs && rule.needs.length && !rule.needs.some((n) => traits(t).includes(n))) return false;
    return true;
  }

  function matchOne(expected, actual) {
    if (actual === undefined || actual === null || actual === '') return false;
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      const n = Number(actual);
      if (expected.gte !== undefined && !(n >= expected.gte)) return false;
      if (expected.lte !== undefined && !(n <= expected.lte)) return false;
      return true;
    }
    const want = Array.isArray(expected) ? expected : [expected];
    const have = Array.isArray(actual) ? actual : [actual];
    return want.some((w) => have.some((h) => String(h) === String(w)));
  }

  function conditionsMet(when, answers) {
    if (!when) return true;
    return Object.keys(when).every((q) => matchOne(when[q], answers[q]));
  }

  function quantity(rule, answers) {
    const q = rule.qty || {};
    let n = (q.base ?? (q.perNight || q.perDay ? 0 : 1)) +
      (q.perNight || 0) * answers.nights +
      (q.perDay || 0) * answers.days;
    if (q.laundry && answers.laundry === 'yes') n = Math.min(n, LAUNDRY_CAP + (q.base || 0));
    if (q.max) n = Math.min(n, q.max);
    n = Math.ceil(n - 1e-9);
    return Math.max(0, n);
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * @param {object} opts
   *   core: the "essentials" type (items for every trip, plus shared questions)
   *   type: the chosen trip type
   *   trip: { nights, answers, includeEssentials }
   *   travelers: [{id, name, kind}]
   * @returns array of list entries
   */
  function generate({ core, type, trip, travelers }) {
    const answers = Object.assign({}, trip.answers || {}, derivedAnswers(trip, travelers));
    const rules = new Map();
    const add = (r, from) => rules.set(slug(r.name), Object.assign({}, r, { from }));
    if (core && trip.includeEssentials !== false) (core.items || []).forEach((r) => add(r, core.id));
    (type.items || []).forEach((r) => add(r, type.id)); // trip-type rules override essentials with the same name

    const out = [];
    for (const rule of rules.values()) {
      if (!conditionsMet(rule.when, answers)) continue;
      const qty = quantity(rule, answers);
      if (qty <= 0) continue;
      const base = {
        name: rule.name,
        category: rule.category || 'misc',
        note: rule.note || '',
        rule: rule.id || slug(rule.name),
        from: rule.from,
        checked: false,
      };
      if (rule.scope === 'each') {
        for (const t of travelers) {
          if (!appliesTo(rule, t)) continue;
          out.push(Object.assign({}, base, { id: slug(rule.name) + '--' + t.id, owner: t.id, qty }));
        }
      } else {
        // A shared item is packed once if anyone it's meant for is coming.
        const for_ = rule.who && rule.who.length ? travelers.filter((t) => rule.who.includes(t.kind)) : travelers;
        if (!for_.length) continue;
        if (rule.needs && rule.needs.length && !for_.some((t) => rule.needs.some((n) => traits(t).includes(n)))) continue;
        out.push(Object.assign({}, base, { id: slug(rule.name), owner: null, qty }));
      }
    }
    // "Always bring" items the family added to someone's profile.
    for (const t of travelers) {
      for (const name of t.always || []) {
        if (!String(name).trim()) continue;
        if (out.some((i) => i.owner === t.id && slug(i.name) === slug(name))) continue;
        out.push({ id: 'always-' + slug(name) + '--' + t.id, name: String(name).trim(), category: 'misc', note: 'Always packed for ' + t.name, rule: 'always-' + slug(name), from: 'profile', owner: t.id, qty: 1, checked: false });
      }
    }
    return out;
  }

  function progress(items) {
    const live = (items || []).filter((i) => !i.skipped);
    const done = live.filter((i) => i.checked).length;
    return { done, total: live.length, pct: live.length ? Math.round((done / live.length) * 100) : 0 };
  }

  const api = { CATEGORIES, NEEDS, categoryOf, generate, isPerson, progress, nightsBetween, conditionsMet, quantity, slug, LAUNDRY_CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PackEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
