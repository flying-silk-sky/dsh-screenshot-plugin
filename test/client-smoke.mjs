// Smoke test: load the hand-written client bundle the way the browser module
// system does (window.__ModuleLoader__.load -> factory(require)) and exercise
// apply() plus React renders with stubbed platform modules.
//
// The stubs deliberately mirror the real module table:
//   - `react` does NOT export createPortal (React 18 keeps it in react-dom);
//   - `react-dom` does export createPortal.
// A second pass loads the bundle with no react-dom at all, to prove the control
// still renders and still opens its menu in that degraded shell.
import assert from "node:assert/strict";

const registered = [];
let loaded = null;

function element(tag, attrs = {}) {
  const node = {
    tag,
    style: {},
    attrs,
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    removeAttribute(name) {
      delete this.attrs[name];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      return child;
    },
    append() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    contains: () => false,
    getBoundingClientRect: () => ({ top: 100, left: 40, width: 24, height: 24, right: 64, bottom: 124 }),
    querySelector: () => null,
    focus() {},
    click() {},
    set textContent(value) {
      this.text = value;
    },
    get textContent() {
      return this.text ?? "";
    },
  };
  return node;
}

globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry;
    },
  },
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener() {},
  removeEventListener() {},
  getComputedStyle: () => ({ color: "rgb(20, 20, 20)" }),
};

globalThis.Node = class Node {};

globalThis.document = {
  head: element("head"),
  body: element("body"),
  documentElement: element("html"),
  createElement: element,
  querySelector: () => null,
  getElementById: (id) => [...document.head.children, ...document.body.children].find((child) => child.id === id) ?? null,
  addEventListener() {},
  removeEventListener() {},
};

// ------------------------------------------------------------ react stubs

let hookStates = [];
let hookIndex = 0;
let rendered = 0;

function resetHooks() {
  hookStates = [];
  hookIndex = 0;
}

class Component {
  constructor(props) {
    this.props = props;
  }

  setState() {}
}

const react = {
  Component,
  createElement: (tag, attrs, ...children) => ({ tag, attrs, children }),
  Fragment: "Fragment",
  useState: (initial) => {
    const index = hookIndex++;
    if (!(index in hookStates)) hookStates[index] = typeof initial === "function" ? initial() : initial;
    return [
      hookStates[index],
      (next) => {
        hookStates[index] = typeof next === "function" ? next(hookStates[index]) : next;
      },
    ];
  },
  useRef: (initial) => {
    const index = hookIndex++;
    if (!(index in hookStates)) hookStates[index] = { current: initial };
    return hookStates[index];
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
};

const reactDom = {
  createPortal: (children, target) => ({ tag: "#portal", attrs: { target }, children: [children] }),
};

function makeRequire(withReactDom) {
  return (specifier) => {
    if (specifier === "react") return react;
    if (specifier === "react/jsx-runtime") {
      return { jsx: react.createElement, jsxs: react.createElement, Fragment: "Fragment" };
    }
    if (specifier === "react-dom") {
      if (!withReactDom) throw new Error("react-dom is not available in this shell");
      return reactDom;
    }
    throw new Error(`unexpected external require: ${specifier}`);
  };
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  visit(node);
  walk(node.children, visit);
}

function findMenuItems(tree) {
  const items = [];
  walk(tree, (node) => {
    if (node.attrs && node.attrs.className === "dsh-shot-item") items.push(node);
  });
  return items;
}

// ------------------------------------------------------------ bundle load

await import("../lib/client.js");

assert.ok(loaded !== null, "bundle must register through window.__ModuleLoader__.load");
assert.equal(loaded.id, "dsh-screenshot-plugin", "bundle id must be the package name");
assert.equal(typeof loaded.factory, "function", "bundle must expose a factory");

const mod = loaded.factory(makeRequire(true));
assert.equal(mod.name, "ui-screenshot", "client plugin name");
assert.deepEqual(mod.inject, ["slots", "locale", "conversation", "sessions"], "client inject list");
assert.equal(typeof mod.apply, "function", "client plugin must export apply");

function makeContext() {
  const registrations = [];
  const ctx = {
    locale: {
      bind: () => (key) => `t:${key}`,
      register: () => () => {},
    },
    slots: {
      inject(name, factory) {
        assert.equal(name, "conversation.input.left", "control must mount in the composer tool row");
        return factory();
      },
      register(options, component) {
        registrations.push({ options, component });
        return () => {};
      },
    },
    conversation: { createDrafts: () => [], releaseDraftAttachments: () => {} },
    sessions: { scope: () => ({}) },
    effect: (factory) => {
      factory();
      return () => {};
    },
  };
  return { ctx, registrations };
}

async function mount(bundle) {
  const { ctx, registrations } = makeContext();
  await bundle.apply(ctx);
  resetHooks();
  assert.equal(registrations.length, 1, "exactly one slot occupant");
  const [{ options, component }] = registrations;
  assert.equal(options.name, "conversation.input.left");
  assert.equal(options.id, "screenshot-capture");
  assert.equal(options.order, 40);
  assert.equal(typeof options.label, "function");
  assert.equal(options.label(), "t:label", "label thunk must localize at read time");
  return { options, component };
}

function render(props) {
  // The occupant body is `Guard -> ScreenshotControl`.
  const guarded = props.component(props.props);
  assert.ok(guarded !== null && guarded !== undefined, "occupant must render");
  assert.equal(typeof guarded.tag, "function", "occupant wraps the control in a guard");
  const child = Array.isArray(guarded.children) ? guarded.children[0] : guarded.children;
  const guard = new guarded.tag({ children: child });
  assert.equal(guard.state.failed, false, "guard must not be in the failed state");
  const control = guard.render();
  assert.ok(control !== null && control !== undefined, "control must render");
  assert.equal(typeof control.tag, "function", "guard renders the control component");
  // Hook cells survive between renders of one instance; only the read cursor resets.
  hookIndex = 0;
  rendered += 1;
  return control.tag(control.attrs);
}

// -------------------------------------------------------- primary pass

const first = await mount(mod);
const firstTree = render({ component: first.component, props: { sessionId: "session-1", inputActions: {}, locked: false } });
const button = firstTree.children[0];
assert.equal(button.tag, "button", `control renders a button (got ${button.tag})`);

// Opening the menu requires a real element behind the ref; the stub ref object
// is the same one the component handed to the button.
button.attrs.ref.current = element("button");
button.attrs.onClick();

const openTree = render({ component: first.component, props: { sessionId: "session-1", inputActions: {}, locked: false } });
const portals = [];
walk(openTree, (node) => {
  if (node.tag === "#portal") portals.push(node);
});
assert.equal(portals.length, 1, "the menu must be portaled through react-dom");
assert.equal(portals[0].attrs.target, document.body, "the menu portals into document.body");
assert.equal(findMenuItems(openTree).length, 2, "the menu offers the two capture modes");
const menu = findMenuItems(openTree)[0];
assert.equal(menu.tag, "button");
assert.equal(menu.attrs.role, "menuitem");
assert.match(JSON.stringify(menu.children), /t:mode\.hide/, "hide mode label comes from the dictionary");

const styles = document.head.children.map((child) => child.text ?? "").join("\n");
assert.equal(document.head.children.length, 1, "styles must be injected exactly once");
assert.ok(styles.includes(".dsh-shot-overlay"), "overlay styles present");
assert.ok(styles.includes(".dsh-shot-button"), "control styles present");
assert.ok(styles.includes(".dsh-shot-menu"), "menu styles present");

// ------------------------------------------------- pass without react-dom

const degraded = loaded.factory(makeRequire(false));
const second = await mount(degraded);
const degradedTree = render({
  component: second.component,
  props: { sessionId: "session-2", inputActions: {}, locked: false },
});
const degradedButton = degradedTree.children[0];
assert.equal(degradedButton.tag, "button", "the control still renders without react-dom");
degradedButton.attrs.ref.current = element("button");
degradedButton.attrs.onClick();
const fallbackTree = render({
  component: second.component,
  props: { sessionId: "session-2", inputActions: {}, locked: false },
});
const fallbackPortals = [];
walk(fallbackTree, (node) => {
  if (node.tag === "#portal") fallbackPortals.push(node);
});
assert.equal(fallbackPortals.length, 0, "no portal is attempted when react-dom is unavailable");
assert.equal(findMenuItems(fallbackTree).length, 2, "the inline fallback still shows both capture modes");

console.log("client bundle smoke test OK");
console.log("  slot:", first.options.name, "id:", first.options.id, "order:", first.options.order);
console.log("  injected style blocks:", document.head.children.length);
console.log("  renders exercised:", rendered);
