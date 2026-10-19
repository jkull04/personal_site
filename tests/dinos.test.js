const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Deterministic clock and a minimal scene let us run minutes of actual steering,
// including resize and pointer lifecycles, without sleeping or launching a browser.
function arena(seed = 7, reduced = false, width = 900, journeyStorage = null) {
  let now = 0, frameId = 0;
  const frames = new Map();
  class Element {
    constructor(classes = []) {
      this.dataset = {}; this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] || ''; } };
      const set = new Set(classes);
      this.classList = { add: (...xs) => xs.forEach(x => set.add(x)), remove: (...xs) => xs.forEach(x => set.delete(x)), contains: x => set.has(x), toggle: (x, value) => { if (value ?? !set.has(x)) set.add(x); else set.delete(x); } };
      this.events = {}; this.children = []; this.isConnected = true; this.offsetWidth = 58; this.offsetHeight = 40;
    }
    addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
    emit(type, props = {}) { (this.events[type] || []).forEach(fn => fn({ button: 0, detail: 1, pointerId: 1, pointerType: 'mouse', ...props })); }
    setAttribute(k, v) { this[k] = v; }
    getAttribute(k) { return this[k]; }
    hasAttribute(k) { return k === 'data-dino-state'; }
    removeAttribute(k) { delete this[k]; }
    matches() { return false; }
    append(element) { this.children.push(element); }
    remove() { this.isConnected = false; }
    closest() { return scene; }
    setPointerCapture(id) { this.capture = id; }
    hasPointerCapture(id) { return this.capture === id; }
    releasePointerCapture() { this.capture = null; this.emit('lostpointercapture'); }
  }
  const scene = new Element(), colosseum = new Element(), floor = new Element(), status = new Element();
  scene.clientWidth = width; scene.clientHeight = width * 544 / 1536;
  scene.getBoundingClientRect = () => ({ left: 0, top: 0, width: scene.clientWidth, height: scene.clientHeight });
  colosseum.getBoundingClientRect = () => ({ left: 0, top: -scene.clientHeight * .40441176, width: scene.clientWidth, height: scene.clientWidth * 1024 / 1536 });
  const buttons = ['leaf', 'meat'].map(type => { const b = new Element(); b.dataset.food = type; return b; });
  const roamers = ['stego', 'raptor', 'longneck'].map((kind, i) => {
    const roamer = new Element(['arena-roamer']), dino = new Element(['dino--' + kind]);
    roamer.dataset.dinoLounge = ['projects', 'writings', 'contact'][i];
    dino.dataset.dinoLounge = roamer.dataset.dinoLounge;
    roamer.querySelector = () => dino; roamer.dino = dino;
    return roamer;
  });
  scene.querySelector = selector => ({ '.arena-colosseum': colosseum, '.arena-floor': floor, '.arena-feeding-status': status }[selector]);
  scene.querySelectorAll = () => buttons;
  const document = new Element(); document.documentElement = new Element(); document.body = new Element(); document.hidden = false;
  document.createElement = () => new Element();
  document.querySelectorAll = selector => selector === '.arena-scene' ? [scene] : selector === '.arena-roamer' ? roamers : selector === '[data-dino]' ? roamers.map(r => r.dino) : [];
  document.querySelector = () => null;
  const motion = { matches: reduced, addEventListener(type, fn) { this.changed = fn; } };
  const math = Object.create(Math); math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const window = new Element(); Object.assign(window, { matchMedia: () => motion, requestAnimationFrame: fn => { frames.set(++frameId, fn); return frameId; }, cancelAnimationFrame: id => frames.delete(id), setTimeout: () => 1, clearTimeout() {}, getComputedStyle: () => ({ getPropertyValue: () => '' }) });
  const epoch = Date.now();
  class Clock extends Date { static now() { return epoch + now; } }
  if (journeyStorage) Object.assign(window, { DinoJourneys: require('../js/dino-journeys.js'), location: { pathname: '/' }, sessionStorage: journeyStorage });
  const context = vm.createContext({ window, document, Math: math, performance: { now: () => now }, Date: Clock, navigator: {}, console });
  const source = fs.readFileSync(require.resolve('../js/dinos.js'), 'utf8').replace(/\}\)\(\);\s*$/, 'globalThis.inspect = { habitats, arenaMotion, remapArenaRoamers, dropFood, getJourneys: () => journeys, inspectionSpot, inspectContent, endInspection, setJourneyPage: page => { journeyPage = page; } };})();');
  vm.runInContext(source, context);
  window.initializeDinoInteractions();
  function advance(ms) { const end = now + ms; while (now < end) { now += 16; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); } }
  return { ...context.inspect, scene, buttons, roamers, document, window, motion, status, frames, advance, now: () => now };
}

test('independent wandering stays inside the floor over two minutes at desktop and mobile sizes', () => {
  for (const width of [900, 350]) for (const seed of [3, 17, 93]) {
    const a = arena(seed, false, width), starts = [...a.arenaMotion.values()].map(s => [s.x, s.y]);
    const visited = new Map();
    for (let i = 0; i < 120; i++) {
      a.advance(1000);
      [...a.arenaMotion.values()].forEach((s, index) => {
        assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y));
        assert.ok(s.x >= s.bounds.minX && s.x <= s.bounds.maxX && s.y >= s.bounds.minY && s.y <= s.bounds.maxY);
        if (Math.hypot(s.x - starts[index][0], s.y - starts[index][1]) > 5) visited.set(index, true);
      });
    }
    assert.equal(visited.size, 3, 'every dinosaur moves of its own accord');
  }
});

test('all snacks are reachable and consumed, including edge drops and competing dinosaurs', () => {
  for (const seed of [1, 5, 25]) {
    const a = arena(seed), h = [...a.habitats.values()][0], b = h.bounds;
    [[b.minX, b.minY], [b.maxX, b.maxY], [b.centerX, b.centerY]].forEach(([x,y], i) => a.dropFood(h, i === 1 ? 'meat' : 'leaf', {x,y}));
    let eaten = 0;
    for (let i = 0; i < 2000; i++) {
      a.advance(16);
      for (const state of a.arenaMotion.values()) if (state.activity === 'eating') eaten |= 1 << [...a.arenaMotion.keys()].indexOf(state.roamer);
      if (!h.foods.length) break;
    }
    assert.equal(h.foods.length, 0, 'food consumed before expiry');
    assert.equal(eaten, 7, 'each dinosaur got a snack');
  }
});

test('dragging adds one snack; invalid and cancelled drags add none; tap and keyboard work', () => {
  const a = arena(), h = [...a.habitats.values()][0], b = h.bounds, button = a.buttons[0];
  button.emit('pointerdown', {clientX: 30, clientY: 30});
  button.emit('pointermove', {clientX: b.centerX, clientY: b.centerY});
  button.emit('pointerup', {clientX: b.centerX, clientY: b.centerY});
  button.emit('click');
  assert.equal(h.foods.length, 1);
  button.emit('pointerdown', {clientX: 30, clientY: 30});
  button.emit('pointermove', {clientX: 2, clientY: 2});
  button.emit('pointerup', {clientX: 2, clientY: 2}); button.emit('click');
  assert.equal(h.foods.length, 1);
  button.emit('pointerdown', {clientX: 30, clientY: 30}); button.emit('pointercancel');
  assert.equal(h.foods.length, 1); assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.emit('click', {detail: 0});
  button.emit('pointerdown', {clientX: 30, clientY: 30}); button.emit('pointerup', {clientX: 30, clientY: 30}); button.emit('click');
  assert.equal(h.foods.length, 3);
});

test('resize preserves positions within new floor; hidden tab pauses; reduced motion feeds without movement', () => {
  const a = arena(); a.advance(4000);
  a.scene.clientWidth = 350; a.scene.clientHeight = 350 * 544 / 1536; a.remapArenaRoamers();
  for (const state of a.arenaMotion.values()) assert.ok(state.x <= state.bounds.maxX && state.y <= state.bounds.maxY);
  a.document.hidden = true; a.document.emit('visibilitychange');
  assert.equal(a.frames.size, 0);
  a.document.hidden = false; a.document.emit('visibilitychange'); assert.equal(a.frames.size, 1);
  a.motion.matches = true; a.motion.changed(); assert.equal(a.frames.size, 0);
  const initial = [...a.arenaMotion.values()].map(s => [s.x, s.y]);
  a.buttons[0].emit('click', {detail: 0}); a.advance(5000);
  assert.equal([...a.habitats.values()][0].foods.length, 0);
  assert.match(a.status.textContent, /enjoyed/);
  assert.deepEqual([...a.arenaMotion.values()].map(s => [s.x, s.y]), initial);
});

test('food cap and expiry prevent unbounded accumulation', () => {
  const a = arena(), h = [...a.habitats.values()][0];
  for (const s of a.arenaMotion.values()) s.fullUntil = 100000;
  for (let i=0; i<15; i++) a.buttons[0].emit('click', {detail: 0});
  assert.equal(h.foods.length, 6);
  a.advance(46000); assert.equal(h.foods.length, 0);
});

test('escape cancels a held snack without turning the release into a tap', () => {
  const a = arena(), h = [...a.habitats.values()][0], button = a.buttons[0];
  button.emit('pointerdown', {clientX: 20, clientY: 20});
  a.document.emit('keydown', {key: 'Escape'});
  button.emit('pointerup', {clientX: 20, clientY: 20}); button.emit('click');
  assert.equal(h.foods.length, 0);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
});

test('cursor interest is temporary, and petting pauses a walking dinosaur', () => {
  const a = arena(1), h = [...a.habitats.values()][0];
  const raptor = [...a.arenaMotion.values()].find(s => s.kind === 'raptor');
  raptor.decisionAt = 0;
  let curious = false;
  for (let i=0; i<1000; i++) {
    a.scene.emit('pointermove', {clientX: raptor.x + 40, clientY: raptor.y});
    a.advance(16);
    curious ||= raptor.activity === 'curious';
  }
  assert.ok(curious);
  a.scene.emit('pointerleave'); a.advance(3500);
  assert.notEqual(raptor.activity, 'curious');
  a.roamers[1].emit('click'); a.advance(800);
  assert.ok(Math.hypot(raptor.vx, raptor.vy) < 1);
});

test('raptor ignores leaves and eats only meat; herbivores never claim meat', () => {
  const a = arena(), h = [...a.habitats.values()][0];
  const states = [...a.arenaMotion.values()], raptor = states.find(s => s.kind === 'raptor');
  states.filter(s => s !== raptor).forEach(s => { s.fullUntil = 100000; });
  a.dropFood(h, 'leaf', {x: raptor.x, y: raptor.y});
  a.advance(3000);
  assert.equal(h.foods.length, 1); assert.equal(raptor.food, null);
  a.dropFood(h, 'meat', {x: raptor.x, y: raptor.y});
  a.advance(3000);
  assert.equal(h.foods.length, 1); assert.equal(h.foods[0].type, 'leaf');
  assert.match(a.status.textContent, /raptor enjoyed the meat/);
  raptor.fullUntil = 100000;
  states.filter(s => s !== raptor).forEach(s => { s.fullUntil = 0; });
  a.dropFood(h, 'meat', {x: h.bounds.centerX, y: h.bounds.centerY});
  a.advance(1000);
  assert.equal(h.foods.find(f => f.type === 'meat').owner, null);
});

test('reduced-motion feeding also respects diets regardless of drop proximity', () => {
  const a = arena(7, true), h = [...a.habitats.values()][0];
  const states = [...a.arenaMotion.values()], raptor = states.find(s => s.kind === 'raptor');
  a.dropFood(h, 'leaf', {x: raptor.x, y: raptor.y});
  assert.doesNotMatch(a.status.textContent, /raptor/);
  a.dropFood(h, 'meat', {x: states[0].x, y: states[0].y});
  assert.match(a.status.textContent, /raptor enjoyed the meat/);
});

test('clicking and feeding show varied classic emoticons without consecutive repeats', () => {
  const a = arena(7, true), raptor = a.roamers[1];
  const faces = new Set([':)', ':D', ';)', ':P', ':]']);
  let previous;
  for (let i=0; i<12; i++) {
    if (i % 2) a.buttons[1].emit('click', {detail: 0});
    else raptor.emit('click');
    const face = raptor.getAttribute('data-tooltip');
    assert.ok(faces.has(face)); assert.notEqual(face, previous); previous = face;
  }
});


test('a traveling raptor is absent at home, returns for meat, and eats after entering', () => {
  const { create } = require('../js/dino-journeys.js');
  const storage = { value: null, getItem() { return this.value; }, setItem(_, value) { this.value = value; } };
  const world = create(storage);
  world.data.members.raptor.page = 'projects'; world.data.members.raptor.until = Date.now() + 90000; world.save(Date.now());
  const a = arena(7, false, 900, storage), h = [...a.habitats.values()][0];
  const raptor = [...a.arenaMotion.values()].find(s => s.kind === 'raptor');
  assert.equal(raptor.roamer.hidden, true);
  a.dropFood(h, 'leaf', { x: h.bounds.centerX, y: h.bounds.centerY });
  a.advance(1000); assert.equal(raptor.roamer.hidden, true);
  a.dropFood(h, 'meat', { x: h.bounds.centerX, y: h.bounds.centerY });
  assert.ok(raptor.transit?.arriving); assert.equal(raptor.roamer.disabled, true);
  a.advance(15000);
  assert.equal(raptor.roamer.hidden, false); assert.equal(raptor.roamer.disabled, false);
  assert.equal(h.foods.filter(f => f.type === 'meat').length, 0);
  a.window.emit('pagehide');
  const saved = create(storage, JSON.parse(storage.value).updated);
  assert.equal(saved.data.members.raptor.page, 'home');
  assert.equal(saved.data.members.raptor.position.page, 'home');
});

test('reduced-motion recall restores the absent diner immediately without walking', () => {
  const { create } = require('../js/dino-journeys.js');
  const storage = { value: null, getItem() { return this.value; }, setItem(_, value) { this.value = value; } };
  const world = create(storage);
  world.data.members.raptor.page = 'projects'; world.data.members.raptor.until = Date.now() + 90000; world.save(Date.now());
  const a = arena(7, true, 350, storage), h = [...a.habitats.values()][0];
  a.dropFood(h, 'meat', { x: h.bounds.centerX, y: h.bounds.centerY });
  const raptor = [...a.arenaMotion.values()].find(s => s.kind === 'raptor');
  assert.equal(raptor.roamer.hidden, false); assert.equal(raptor.transit, null);
  assert.equal(h.foods.length, 0); assert.equal(a.frames.size, 0);
});


test('content inspection uses only clear space, persists without fading, and restores on resize', () => {
  const storage = { getItem() { return null; }, setItem() {} };
  const a = arena(7, false, 900, storage);
  a.window.innerWidth = 1000; a.window.innerHeight = 800; a.window.scrollX = 0; a.window.scrollY = 900;
  const target = { getBoundingClientRect: () => ({left:100,right:240,top:300,bottom:510,width:140,height:210}) };
  assert.equal(a.inspectionSpot(target).x, 248);
  const originalQuery = a.document.querySelectorAll;
  const blocker = { closest: () => null, getBoundingClientRect: () => ({left:0,right:1000,top:100,bottom:800,width:1000,height:700}) };
  a.document.querySelectorAll = selector => selector.startsWith('a, button') ? [blocker] : originalQuery(selector);
  assert.equal(a.inspectionSpot(target), undefined, 'never covers occupied content');
  a.document.querySelectorAll = originalQuery;
  const state = [...a.arenaMotion.values()][0];
  a.scene.getBoundingClientRect = () => ({left:0,right:900,top:-900,bottom:-500,width:900,height:400});
  a.setJourneyPage('books');
  a.getJourneys().data.members[state.kind].page = 'books';
  a.inspectContent(state, target); assert.ok(state.inspection);
  state.habitat.visible = false;
  a.advance(1500); assert.equal(state.dino.classList.contains('is-idle'), true);
  a.advance(10000); assert.ok(state.inspection, 'no timed disappearance');
  a.window.emit('scroll'); assert.ok(state.inspection);
  a.window.emit('resize'); assert.equal(state.inspection, null);
  assert.equal(state.roamer.style.opacity, '1');
});

test('autonomous departures remain fully opaque and disappear only beyond the scene edge', () => {
  const storage = { getItem() { return null; }, setItem() {} };
  const a = arena(3, false, 900, storage);
  a.getJourneys().data.nextTrip = 0;
  a.advance(16);
  const state = [...a.arenaMotion.values()].find(s => s.transit && !s.transit.arriving);
  assert.ok(state);
  for (let i = 0; i < 700 && !state.roamer.hidden; i++) {
    a.advance(16);
    assert.equal(state.roamer.style.opacity, '1');
  }
  assert.equal(state.roamer.hidden, true);
  assert.ok(state.x < 0 || state.x > a.scene.clientWidth, 'walked completely off the scene');
});


test('delegated attention notices new headings, images and form controls without rebinding', () => {
  const a = arena(7, false, 900, { getItem() { return null; }, setItem() {} });
  const makeTarget = x => ({ isConnected: true,
    closest(selector) { return ['.arena-scene, .arena-pantry', 'a[href]', '.book-cover, .album-trigger'].includes(selector) ? null : this; },
    getBoundingClientRect: () => ({left:x, right:x+100, top:20, bottom:80, width:100, height:60}) });
  for (const [event, x] of [['click', 40], ['input', 700], ['change', 120]]) {
    a.document.emit(event, { target: makeTarget(x) });
    const attentive = [...a.arenaMotion.values()].filter(s => s.attention?.until > a.now());
    assert.ok(attentive.length, `${event} attracts attention`);
    assert.ok(attentive.every(s => s.attention.u >= 0 && s.attention.u <= 1));
    a.advance(5500);
  }
});
