const test = require('node:test');
const assert = require('node:assert');
const E = require('../public/engine.js');
const seed = require('../seed.js');

const fam = [
  { id: 'dad', name: 'Dad', kind: 'adult' },
  { id: 'mom', name: 'Mom', kind: 'adult' },
  { id: 'kid', name: 'Kid', kind: 'kid' },
];
const type = (id) => seed.types.find((t) => t.id === id);
const gen = (id, answers, nights = 3, travelers = fam) =>
  E.generate({ core: seed.core, type: type(id), trip: { nights, answers }, travelers });
const find = (list, name, owner) => list.find((i) => i.name === name && (owner === undefined || i.owner === owner));

test('every type generates a sensible list', () => {
  for (const t of seed.types) {
    const list = gen(t.id, { weather: ['mild'], laundry: 'no' });
    assert.ok(list.length > 25, `${t.id} has ${list.length} items`);
    assert.equal(new Set(list.map((i) => i.id)).size, list.length, `${t.id} ids are unique`);
  }
});

test('clothing scales with days and laundry caps it', () => {
  const noLaundry = gen('beach', { weather: ['hot'], laundry: 'no' }, 9);
  const laundry = gen('beach', { weather: ['hot'], laundry: 'yes' }, 9);
  assert.equal(find(noLaundry, 'Underwear', 'dad').qty, 11); // 1 spare + 10 days
  assert.equal(find(laundry, 'Underwear', 'dad').qty, 5);
});

test('conditions include and exclude items', () => {
  const tentTrip = gen('camping', { shelter: 'tent', fire: 'yes', activities: ['fishing'] });
  const cabinTrip = gen('camping', { shelter: 'cabin', fire: 'no', activities: [] });
  assert.ok(find(tentTrip, 'Tent'));
  assert.ok(find(tentTrip, 'Fishing rods & tackle'));
  assert.ok(!find(cabinTrip, 'Tent'));
  assert.ok(!find(cabinTrip, 'Firewood (buy local)'));
});

test('per-person items respect who', () => {
  const list = gen('climbing', { style: 'sport', ropeOwn: 'yes' });
  assert.ok(find(list, 'Belay device & belay carabiner', 'dad'));
  assert.ok(!find(list, 'Belay device & belay carabiner', 'kid'));
  assert.ok(find(list, 'Harness', 'kid'));
  assert.equal(find(list, 'Quickdraws').qty, 12);
  assert.ok(!find(list, 'Cams'));
});

test('baby items only appear with a baby', () => {
  assert.ok(!find(gen('beach', {}), 'Diapers'));
  const withBaby = gen('beach', { swim: 'yes' }, 2, [...fam, { id: 'bb', name: 'Baby', kind: 'baby' }]);
  assert.equal(find(withBaby, 'Diapers', 'bb').qty, 21);
  assert.ok(find(withBaby, 'Swim diapers'));
});

test('trip type item overrides essentials with the same name', () => {
  const list = gen('beach', { weather: ['hot'] });
  const sunscreen = list.filter((i) => i.name === 'Sunscreen');
  assert.equal(sunscreen.length, 1);
  assert.equal(sunscreen[0].from, 'beach');
});

test('easy-to-forget answers add the right items on any trip', () => {
  const without = gen('ski', { weather: ['snow'] });
  assert.ok(!find(without, 'Swimsuit'));
  const withPool = gen('ski', { weather: ['snow'], pool: 'yes', flying: 'yes' });
  assert.ok(find(withPool, 'Swimsuit', 'kid'));
  assert.ok(find(withPool, 'Boarding passes'));
  assert.ok(find(withPool, 'Gum or lollipops for ear pressure'));
});

test('family profiles add each person\'s own things', () => {
  const people = [
    { id: 'dad', name: 'Dad', kind: 'adult', needs: ['meds', 'glasses'] },
    { id: 'kid', name: 'Kid', kind: 'kid', needs: ['contacts'], always: ['Blue blankie'] },
  ];
  const list = gen('beach', {}, 3, people);
  assert.ok(find(list, 'Daily medication', 'dad'));
  assert.ok(!find(list, 'Daily medication', 'kid'));
  assert.ok(find(list, 'Glasses & case', 'dad'));
  assert.ok(find(list, 'Glasses & case', 'kid'), 'contact wearers bring backup glasses');
  assert.ok(find(list, 'Contacts & solution', 'kid'));
  assert.ok(!find(list, 'Contacts & solution', 'dad'));
  assert.ok(find(list, 'Blue blankie', 'kid'));
});

test('pets get their own list and never get people things', () => {
  const dog = { id: 'rex', name: 'Rex', kind: 'pet', species: 'dog' };
  const cat = { id: 'tom', name: 'Tom', kind: 'pet', species: 'cat' };
  const list = gen('camping', { shelter: 'tent' }, 2, [...fam, dog, cat]);
  assert.equal(find(list, 'Pet food', 'rex').qty, 4);
  assert.ok(find(list, 'Leash', 'rex'));
  assert.ok(!find(list, 'Leash', 'tom'));
  assert.ok(find(list, 'Litter box & litter', 'tom'));
  assert.ok(!find(list, 'Sleeping bag', 'rex'));
  assert.ok(!find(list, 'Toothbrush', 'rex'));
  assert.ok(!find(gen('camping', { shelter: 'tent' }), 'Pet food'));
});

test('trip length and laundry set clothing amounts', () => {
  const short = gen('hiking', { laundry: 'no' }, 2);
  const long = gen('hiking', { laundry: 'no' }, 10);
  const longWash = gen('hiking', { laundry: 'yes' }, 10);
  assert.equal(find(short, 'Underwear', 'dad').qty, 4);
  assert.equal(find(long, 'Underwear', 'dad').qty, 12);
  assert.equal(find(longWash, 'Underwear', 'dad').qty, 5);
});

test('easy-to-forget questions are not duplicated by any trip type', () => {
  const coreIds = new Set(seed.core.questions.map((q) => q.id));
  for (const t of seed.types) {
    const dup = t.questions.filter((q) => coreIds.has(q.id)).map((q) => q.id);
    assert.deepEqual(dup, [], `${t.id} repeats ${dup}`);
  }
});

test('nights between dates', () => {
  assert.equal(E.nightsBetween('2026-12-20', '2026-12-27'), 7);
  assert.equal(E.nightsBetween('2026-03-07', '2026-03-09'), 2); // across a DST change
});

test('every item condition points at a real question and option', () => {
  const derived = new Set(['nights', 'days', 'travelers', 'kids', 'baby', 'pet']);
  for (const t of seed.types) {
    const qs = new Map([...seed.core.questions, ...t.questions].map((q) => [q.id, q]));
    assert.equal(new Set(t.questions.map((q) => q.id)).size, t.questions.length, `${t.id} question ids are unique`);
    for (const i of t.items) {
      for (const [qid, want] of Object.entries(i.when || {})) {
        if (derived.has(qid)) continue;
        const q = qs.get(qid);
        assert.ok(q, `${t.id} / ${i.name} uses unknown question ${qid}`);
        const valid = q.type === 'yesno' ? ['yes', 'no'] : q.options.map((o) => o.value);
        for (const v of [].concat(want)) assert.ok(valid.includes(v), `${t.id} / ${i.name}: ${qid}=${v} is not an option`);
      }
    }
  }
});

test('the newer trip types answer their questions', () => {
  assert.equal(seed.types.length, 33);
  assert.equal(new Set(seed.types.map((t) => t.id)).size, 33);
  const hut = gen('xcski', { activity: ['classic'], gear: 'own', hut: 'yes', avalanche: 'no' });
  assert.ok(find(hut, 'Kick wax & cork'));
  assert.ok(find(hut, 'Sleeping bag', 'kid'));
  assert.ok(!find(hut, 'Avalanche beacon', 'dad'));
  const lake = gen('canoe', { boat: 'canoe', boats: 'own', portage: 'yes', overnight: 'no' });
  assert.ok(find(lake, 'Portage yoke or carry pads'));
  assert.ok(!find(lake, 'Spray skirt', 'dad'));
  assert.ok(!find(lake, 'Tent'));
  const ice = gen('fishing', { where: 'ice', license: 'yes' });
  assert.ok(find(ice, 'Ice auger'));
  assert.ok(!find(ice, 'Landing net'));
  assert.ok(!find(ice, 'Buy fishing licenses'));
  const hockey = gen('tournament', { sport: 'hockey', outdoor: 'no' });
  assert.ok(find(hockey, 'Hockey skates, helmet & full gear', 'kid'));
  assert.ok(!find(hockey, 'Hockey skates, helmet & full gear', 'dad'));
  assert.ok(find(hockey, 'Blanket for the stands'));
  const party = gen('wedding', { role: 'party', dresscode: 'formal' });
  assert.ok(find(party, 'Speech or toast notes'));
  assert.ok(find(party, 'Tux or dark suit', 'mom'));
  const surf = gen('surf', { boards: 'rent', water: 'cold' });
  assert.ok(find(surf, 'Wetsuit', 'kid'));
  assert.ok(!find(surf, 'Surfboards'));
  const camp = gen('summercamp', { camp: 'overnight', sleepbag: 'yes' }, 7, [{ id: 'kid', name: 'Kid', kind: 'kid' }]);
  assert.ok(find(camp, 'Sleeping bag', 'kid'));
  assert.ok(!find(camp, 'Lunch box & ice pack', 'kid'));
  const birth = gen('hospital', { reason: 'birth', partner: 'yes' }, 2, fam.slice(0, 2));
  assert.ok(find(birth, 'Car seat installed'));
  assert.ok(!find(birth, 'Button-front or loose tops'));
  const via = gen('scramble', { route: 'via', snow: 'no' });
  assert.ok(find(via, 'Via ferrata lanyard set', 'kid'));
  assert.ok(!find(via, 'Crampons', 'dad'));
});

test('deleting a question does not hide the items that depended on it', () => {
  const ski = JSON.parse(JSON.stringify(type('ski')));
  const own = E.generate({ core: seed.core, type: ski, trip: { nights: 3, answers: { gear: 'own', sport: 'ski' } }, travelers: fam });
  const rent = E.generate({ core: seed.core, type: ski, trip: { nights: 3, answers: { gear: 'rent', sport: 'ski' } }, travelers: fam });
  assert.ok(find(own, 'Skis & poles', 'dad'));
  assert.ok(!find(rent, 'Skis & poles', 'dad'));
  assert.ok(!find(own, 'Snowboard', 'dad'));
  // The family removed the "own or rent?" and "ski or board?" questions.
  ski.questions = ski.questions.filter((q) => !['gear', 'sport'].includes(q.id));
  const list = E.generate({ core: seed.core, type: ski, trip: { nights: 3, answers: {} }, travelers: fam });
  for (const name of ['Skis & poles', 'Ski / snowboard boots', 'Helmet']) assert.ok(find(list, name, 'dad'), name);
  // Answered questions still count, and so do the ones Pack Pal works out itself.
  assert.ok(!find(list, 'Lift passes'));
  assert.ok(!find(list, 'Ski school forms & lunch money'));
});

test('headphones are packed on every trip', () => {
  for (const t of seed.types) {
    const list = gen(t.id, { weather: ['mild'], laundry: 'no', flying: 'no' });
    assert.ok(list.some((i) => /headphones/i.test(i.name) && i.owner === 'dad'), t.id);
    assert.equal(list.filter((i) => /headphones/i.test(i.name) && i.owner === 'dad').length, 1, t.id + ' has one pair for dad');
  }
});
