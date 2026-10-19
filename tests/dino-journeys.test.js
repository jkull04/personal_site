const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, pageForPath } = require('../js/dino-journeys.js');
const storage = () => ({ value: null, getItem() { return this.value; }, setItem(_, value) { this.value = value; } });
const away = world => Object.entries(world.data.members).filter(([, m]) => m.page !== 'home');

test('only public top-level pages participate; article and Studio routes stay quiet', () => {
  for (const path of ['/', '/index.html']) assert.equal(pageForPath(path), 'home');
  for (const path of ['/books/', '/books/index.html', '/books']) assert.equal(pageForPath(path), 'books');
  for (const path of ['/studio/', '/writings/an-essay/', '/404.html']) assert.equal(pageForPath(path), null);
});
test('a single resident follows, survives reload, and returns home on schedule', () => {
  const s = storage(); let world = create(s, 1000, () => .5);
  world.arrive('home', 1000); world.arrive('books', 2000);
  assert.equal(away(world).length, 1); assert.equal(away(world)[0][0], 'longneck');
  const until = world.data.members.longneck.until;
  world.data.members.longneck.position = { page: 'books', u: .35, v: .7 };
  world.data.members.longneck.reaction = ':D'; world.save(3000);
  world = create(s, 4000, () => 0); world.arrive('books', 4000);
  assert.equal(world.data.members.longneck.until, until);
  assert.equal(world.data.members.longneck.position.u, .35);
  assert.equal(world.data.members.longneck.reaction, ':D');
  world.tick('books', until + 1, false); assert.equal(away(world).length, 0);
});
test('favorite hangouts and the raptor following preference hold across many visits', () => {
  let seed = 42;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const [page, favorite] of [['books', 'longneck'], ['photography', 'stego']]) {
    const counts = { stego: 0, raptor: 0, longneck: 0 };
    for (let i = 0; i < 1000; i++) {
      const world = create(null, 0, random); world.arrive('home', 0); world.arrive(page, 1);
      if (away(world).length) counts[away(world)[0][0]]++;
    }
    assert.ok(counts[favorite] > counts.raptor && counts.raptor > counts[page === 'books' ? 'stego' : 'longneck']);
  }
  const world = create(null, 0, () => .4); world.arrive('home', 0); world.arrive('writings', 1);
  assert.equal(away(world)[0][0], 'raptor'); world.arrive('contact', 2);
  assert.equal(world.data.members.raptor.page, 'contact');
});
test('food recalls only eligible diners and prevents immediate departure', () => {
  const world = create(null, 0, () => .4); world.arrive('writings', 1);
  assert.equal(world.data.members.raptor.page, 'writings');
  world.recall('leaf', 2); assert.equal(world.data.members.raptor.page, 'writings');
  world.recall('meat', 3); assert.equal(away(world).length, 0);
  world.tick('home', 60000, true); assert.equal(away(world).length, 0);
});
test('navigation, excursions and expiry never duplicate visitors; reduced motion has no autonomous trips', () => {
  const world = create(null, 0, () => .2);
  const pages = ['home', 'books', 'photography', 'contact', 'projects', 'writings'];
  for (let i = 0; i < 500; i++) {
    world.arrive(pages[i % 6], i * 10000);
    world.tick(pages[i % 6], i * 10000 + 1000, true);
    assert.ok(away(world).length <= 1);
    assert.equal(Object.keys(world.data.members).length, 3);
  }
  const still = create(null, 0, () => 0);
  still.tick('home', 70000, false); assert.equal(away(still).length, 0);
  still.tick('home', 70001, true); assert.equal(away(still).length, 1);
});
test('malformed, stale or blocked session storage degrades safely', () => {
  for (const value of ['bad', '{}', '{"version":1,"updated":0,"members":{}}']) {
    const s = storage(); s.value = value;
    assert.equal(away(create(s, 100)).length, 0);
  }
  const s = storage(); const world = create(s, 0, () => .5); world.arrive('books', 1);
  assert.equal(away(create(s, 1800002)).length, 0);
  const blocked = create({ getItem() { throw Error(); }, setItem() { throw Error(); } }, 0, () => .5);
  assert.doesNotThrow(() => blocked.arrive('books', 1));
});

test('roughly nine in ten ordinary navigations bring one companion, including home', () => {
  let seed = 84, count = 0;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1000; i++) {
    const world = create(null, 0, random); world.arrive('home', 0); world.arrive('books', 1);
    if (away(world).length) count++;
  }
  assert.ok(count > 860 && count < 950, `${count}/1000 follows`);
  const world = create(null, 0, () => .5); world.arrive('home', 0); world.arrive('books', 1);
  const kind = away(world)[0][0]; world.arrive('home', 2);
  assert.equal(world.data.members[kind].page, 'home');
  assert.equal(world.data.members[kind].arriving, 'home');
});
test('navigation curiosity keeps the same interested dinosaur through activation and arrival', () => {
  const s = storage(); const world = create(s, 1000, () => .5); world.arrive('home', 1000);
  const kind = world.notice('books', 1100);
  assert.equal(kind, 'longneck');
  assert.equal(world.notice('books', 1200), kind);
  const destination = create(s, 1300, () => .99); destination.arrive('books', 1300);
  assert.equal(destination.data.members[kind].page, 'books');
  assert.equal(away(destination).length, 1);
});
