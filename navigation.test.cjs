const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/index.html`, 'utf8');

function navigation() {
  const callbacks = {}, events = [], hashes = [];
  const stage = {
    innerHTML: '', classList: { contains: () => false },
    get firstElementChild() { return this.innerHTML ? {} : null; },
    querySelector: () => null, setAttribute() {},
    addEventListener(name, callback) { callbacks[name] = callback; },
    scrollIntoView() {},
  };
  const nodes = new Map();
  const context = {
    stage, slides: Array.from({ length: 23 }, (_, i) => ({ title: `slide ${i}`, blocks: [] })),
    current: 0, readingPositions: new Map(), renders: 0,
    renderHTML() { context.renders++; return 'content'; }, referenceMarkup: x => x,
    fa: String, resize() {}, isCompact:()=>false, deckAssets: {hydrate() {},prepare() {}}, innerWidth: 1280, modal: false, intro: false,
    document: {
      addEventListener(name, callback) { callbacks[name] = callback; },
      body: { classList: { contains: name => name === 'intro-on' && context.intro } },
      querySelector: () => context.modal ? {} : null,
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, { style: {} }); return nodes.get(id); },
    },
    window: { dispatchEvent: event => events.push(event), advanceFragment: () => false },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    history: { pushState: (_, __, hash) => hashes.push(hash) },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function renderSlide('), source.indexOf("document.getElementById('next').onclick")), context);
  vm.runInContext(source.slice(source.indexOf('let touchStart = null;'), source.indexOf("addEventListener('resize',resize)")), context);
  vm.runInContext(source.slice(source.indexOf("document.addEventListener('keydown',e=>{if(e.defaultPrevented"), source.indexOf('let touchStart = null;')), context);
  return { context, stage, callbacks, events, hashes };
}

test('invalid, fractional and out-of-range slide numbers always resolve to a valid slide', () => {
  const { context } = navigation();
  for (const [input, expected] of [[3.5, 3], [-4, 0], [99, 22], [Infinity, 0], [NaN, 0], ['oops', 0]]) {
    context.renderSlide(input);
    assert.equal(context.current, expected);
  }
});

test('boundary navigation and selecting the current slide preserve its DOM and state', () => {
  const { context, hashes } = navigation();
  context.renderSlide(22);
  const renders = context.renders;
  context.move(1);
  context.renderSlide(22);
  assert.equal(context.renders, renders);
  assert.equal(hashes.length, 1);
  context.renderSlide(22, false, true);
  assert.equal(context.renders, renders + 1);
  assert.equal(hashes.length, 1);
});

test('real slide changes create history entries and history restoration creates none', () => {
  const { context, hashes, events } = navigation();
  context.renderSlide(3, false);
  context.move(1);
  context.renderSlide(3, false);
  context.renderSlide(3, false, true);
  assert.deepEqual(hashes, ['#slide=5']);
  assert.deepEqual(events.map(e => e.detail.entering), [true, true, true, false]);
});

test('dialogs and opening animation block background slide changes', () => {
  const { context } = navigation();
  context.renderSlide(3, false);
  context.modal = true;
  context.move(1);
  assert.equal(context.current, 3);
  context.modal = false;
  context.intro = true;
  context.move(-1);
  assert.equal(context.current, 3);
});

test('swiping interactive props or reading text never changes slides', () => {
  for (const selector of ['.sprop', '.hook-card p', '.table-wrap']) {
    const { context, callbacks } = navigation();
    context.renderSlide(3, false);
    callbacks.touchstart({ touches: [{}], changedTouches: [{ identifier: 1, clientX: 200, clientY: 100 }], target: { closest: s => s.includes(selector) } });
    callbacks.touchend({ touches: [], changedTouches: [{ identifier: 1, clientX: 50, clientY: 100 }] });
    assert.equal(context.current, 3);
  }
});

test('horizontal swipes navigate once while vertical scroll and pinch do not', () => {
  const { context, callbacks } = navigation();
  context.renderSlide(3, false);
  const start = () => callbacks.touchstart({ touches: [{}], changedTouches: [{ identifier: 1, clientX: 200, clientY: 100 }], target: { closest: () => null } });
  start();
  callbacks.touchend({ touches: [], changedTouches: [{ identifier: 1, clientX: 350, clientY: 100 }] });
  assert.equal(context.current, 4);
  start();
  callbacks.touchend({ touches: [], changedTouches: [{ identifier: 1, clientX: 150, clientY: 300 }] });
  assert.equal(context.current, 4);
  start();
  callbacks.touchmove({ touches: [{}, {}] });
  callbacks.touchend({ touches: [], changedTouches: [{ identifier: 1, clientX: 50, clientY: 100 }] });
  assert.equal(context.current, 4);
});

test('keyboard shortcuts respect reading focus, editing, modifiers and repeated keys', () => {
  const { context, callbacks } = navigation();
  context.renderSlide(3, false);
  const key = overrides => callbacks.keydown({ key: 'ArrowDown', preventDefault() {}, target: { closest: () => null }, ...overrides });
  key({ target: { closest: s => s.includes('.hook-card p') } });
  key({ target: { closest: s => s.includes('[contenteditable]') } });
  key({ ctrlKey: true });
  key({ altKey: true });
  key({ metaKey: true });
  key({ repeat: true });
  key({ isComposing: true });
  assert.equal(context.current, 3);
  key({});
  assert.equal(context.current, 4);
});

test('right arrow advances and left arrow returns to the previous slide', () => {
  const { context, callbacks } = navigation();
  context.renderSlide(3, false);
  const key = name => callbacks.keydown({key:name,preventDefault(){},target:{closest:()=>null}});
  key('ArrowRight');assert.equal(context.current,4);
  key('ArrowLeft');assert.equal(context.current,3);
});

test('reading retains English terminology as a label and advances directly to the explanatory text', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function readingContent('), source.indexOf('function renderSlide(')), context);
  const content = context.readingContent({hook:'پرسش', blocks:[
    {type:'text', text:'Mythic–Literal Faith', html:'Mythic–Literal Faith'},
    {type:'text', text:'شرح مرحله', html:'<strong>شرح مرحله</strong>'},
    {type:'text', text:'نمونهٔ آموزشی', html:'نمونهٔ آموزشی'},
  ]});
  assert.equal(content.term, 'Mythic–Literal Faith');
  assert.deepEqual(Array.from(content.parts), ['پرسش', '<strong>شرح مرحله</strong>', 'نمونهٔ آموزشی']);
});

test('the complete presentation script compiles before navigation is tested in isolation', () => {
  const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
});

test('the public presentation contains no links to private machine paths', () => {
  assert.doesNotMatch(source, /\b[A-Za-z]:[/\\]Users[/\\]|file:\/\//i);
});
