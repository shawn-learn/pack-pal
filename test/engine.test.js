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
  const withPool = gen('ski', { weather: ['snow'], pool: 'yes', eyes: 'yes', flying: 'yes' });
  assert.ok(find(withPool, 'Swimsuit', 'kid'));
  assert.ok(find(withPool, 'Contacts & solution'));
  assert.ok(find(withPool, 'Boarding passes'));
  assert.ok(find(withPool, 'Gum or lollipops for ear pressure'));
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
