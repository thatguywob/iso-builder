// Falsification: target/frame/context substitution, late events, a failed socket
// and incomplete terminal cleanup must invalidate an otherwise captured byte
// snapshot. This mock boundary does not establish a real browser census.
const { test, expect } = require("@playwright/test");
const { EventEmitter } = require("node:events");
const { FlatConnection } = require("./owned-flat-cdp");
const { BodyReservations } = require("./owned-flat-body-reservations");
const { openOwnedFrontendController } = require("./owned-flat-frontend-controller");
const ORIGIN = "http://127.0.0.1:1234", DOCUMENT = Buffer.from("<h1>tiny</h1>");
const tick = () => new Promise(resolve => setImmediate(resolve));
class Socket extends EventEmitter {
  constructor(mode) { super(); this.mode = mode; this.calls = []; this.created = false; this.navigated = false; this.sources = new Map(); this.failure = null; }
  addEventListener(name, fn) { this.on(name, fn); }
  close() {}
  event(method, params, sessionId) { this.emit("message", { data: JSON.stringify({ method, params, ...(sessionId ? { sessionId } : {}) }) }); }
  target() { return { targetId: "page-target", type: "page", browserContextId: "context", url: ORIGIN + "/" }; }
  send(text) {
    const packet = JSON.parse(text); this.calls.push(packet); let result = {};
    switch (packet.method) {
      case "Target.getTargets":
        result = { targetInfos: this.created ? [this.target()] : this.mode === "initial-target" ? [this.target()] : [] };
        if (this.created && this.mode === "final-extra-target") result.targetInfos.push({ targetId: "other", type: "worker" });
        if (this.created && this.mode === "final-context") result.targetInfos[0].browserContextId = "foreign";
        break;
      case "Target.createBrowserContext": result = { browserContextId: "context" }; break;
      case "Target.createTarget":
        this.created = true;
        this.event("Target.targetCreated", { targetInfo: { ...this.target(), url: "about:blank" } });
        this.event("Target.attachedToTarget", { sessionId: "page", waitingForDebugger: true, targetInfo: { ...this.target(), url: "about:blank" } });
        result = { targetId: "page-target" }; break;
      case "Page.navigate": {
        this.navigated = true;
        this.event("Target.targetInfoChanged", { targetInfo: this.target() });
        this.event("Network.requestWillBeSent", { requestId: "document", frameId: "frame", type: "Document", request: { url: ORIGIN + "/", method: "GET" } }, "page");
        this.event("Network.responseReceived", { requestId: "document", type: "Document", response: { url: ORIGIN + "/", status: 200,
          headers: { "Content-Length": String(DOCUMENT.length) }, fromDiskCache: false, fromPrefetchCache: false, fromServiceWorker: false } }, "page");
        this.event("Network.loadingFinished", { requestId: "document" }, "page");
        this.event("Page.frameNavigated", { frame: { id: "frame", url: ORIGIN + "/" } }, "page");
        if (this.mode !== "missing-context") this.event("Runtime.executionContextCreated", { context: { id: 7, origin: ORIGIN,
          auxData: { isDefault: true, frameId: this.mode === "wrong-context-frame" ? "other" : "frame" } } }, "page");
        this.event("Page.loadEventFired", {}, "page"); result = { frameId: "frame" }; break;
      }
      case "Network.getResponseBody": result = { body: DOCUMENT.toString("base64"), base64Encoded: true }; break;
      case "Runtime.evaluate": {
        const scriptId = `controller-${this.sources.size+1}`, url = packet.params.expression.split("//# sourceURL=").at(-1);
        this.sources.set(scriptId,packet.params.expression);
        this.event("Debugger.scriptParsed",{scriptId,url,executionContextId:7,scriptLanguage:"JavaScript"},"page");
        result = { result: { type: "object", value: { measured: 1 } } }; break;
      }
      case "Debugger.getScriptSource": result = { scriptSource:this.sources.get(packet.params.scriptId) }; break;
      case "Page.getFrameTree": result = { frameTree: { frame: { id: "frame", url: this.navigated ? ORIGIN + "/" : "about:blank", securityOrigin: ORIGIN } } };
        if (this.navigated && this.mode === "child-frame") result.frameTree.childFrames = [{ frame: { id: "child" } }]; break;
    }
    queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: packet.id, sessionId: packet.sessionId, result }) }));
  }
}
function fixture(mode = "valid") {
  const socket = new Socket(mode), connection = new FlatConnection(socket, { commandMs: 100, bodyReservations: new BodyReservations() });
  let verifies = 0, closes = 0, closeHook;
  const owned = { connection, pin: { browserVersion: "fixture-only" }, async verify() {
    verifies++; if (verifies === 2 && mode === "late-after-snapshot") socket.event("Network.requestWillBeSent", { requestId: "late", type: "Script", request: { url: ORIGIN + "/late.js", method: "GET" } }, "page");
  }, async close() {
    closes++;
    if (closeHook) await closeHook();
    if (mode === "late-during-close") socket.event("Network.requestWillBeSent", { requestId: "late", type: "Script", request: { url: ORIGIN + "/late.js", method: "GET" } }, "page");
    if (mode === "late-connection-failure") connection.fail("command-rejected");
    connection.close();
    if (mode === "late-socket-failure") socket.failure = new Error("untrusted secret");
    if (mode === "cleanup-rejection") throw new Error("untrusted secret");
  } };
  return { socket, connection, owned, open: () => openOwnedFrontendController(owned, { documentURL: ORIGIN + "/", workerURLs: [], timeoutMs: 50 }),
    get closes() { return closes; }, holdClose(hook) { closeHook = hook; } };
}
test("controller uses actual target/frame/default execution context and awaits owned cleanup", async () => {
  const f = fixture(), controller = await f.open();
  expect(await controller.evaluate("({measured:1})")).toEqual({ measured: 1 });
  expect(f.socket.calls.find(command => command.method === "Runtime.evaluate")).toMatchObject({ sessionId: "page", params: { contextId: 7, awaitPromise: true, returnByValue: true } });
  let release, completed = false;
  f.holdClose(() => new Promise(resolve => { release = resolve; }));
  const pending = controller.finish().then(value => { completed = true; return value; }); await tick();
  expect(completed).toBe(false); expect(f.closes).toBe(1); release();
  const result = await pending; expect(result).toMatchObject({ freshContextCreated: true, mainFrameCount: 1, terminalCleanupVerified: true, completeCoverage: false, collectorProofEstablished: false });
  expect(result.assets).toHaveLength(1); expect(f.connection.closed).toBe(true);
  await controller.dispose(); expect(f.closes).toBe(1);
});
for (const mode of ["initial-target", "missing-context", "wrong-context-frame"]) test(`controller rejects setup ${mode} and cleans up`, async () => {
  const f = fixture(mode); await expect(f.open()).rejects.toThrow("owned-controller:"); expect(f.closes).toBe(1); expect(f.connection.closed).toBe(true);
});
for (const mode of ["final-extra-target", "final-context", "child-frame", "late-after-snapshot", "late-during-close", "late-connection-failure", "late-socket-failure", "cleanup-rejection"]) test(`controller rejects ${mode} after bytes are captured`, async () => {
  const f = fixture(mode), controller = await f.open();
  await expect(controller.finish()).rejects.toThrow(/^owned-controller:[a-z-]+$/); expect(f.closes).toBe(1); expect(f.connection.closed).toBe(true);
});
test("unowned late worker invalidates independent census", async () => {
  const f = fixture(), controller = await f.open();
  f.socket.event("Target.targetCreated", { targetInfo: { type: "service_worker", targetId: "foreign" } });
  await expect(controller.finish()).rejects.toThrow("owned-controller:"); expect(f.closes).toBe(1);
});

test("unretained data events do not grow frontend reservations or exhaust retained event budget", async () => {
  const f = fixture(), controller = await f.open();
  const before = f.connection.bodyReservations.snapshot().reservedBytes;
  for (let i=0;i<10000;i++) f.socket.event("Network.dataReceived", {requestId:"blob",dataLength:65536,encodedDataLength:65536},"page");
  expect(f.connection.bodyReservations.snapshot().reservedBytes).toBe(before);
  expect((await controller.finish()).assets).toHaveLength(1);
});
for (const url of ["", "blob:http://127.0.0.1:1234/unowned", "wasm://wasm/unowned", ORIGIN+"/"]) test(`unexpected page script ${JSON.stringify(url)} cannot hide in source census`, async () => {
  const f = fixture(), controller = await f.open();
  f.socket.event("Debugger.scriptParsed", {scriptId:"unexpected",url,executionContextId:7},"page");
  await expect(controller.finish()).rejects.toThrow("owned-controller:");
});
test("unowned non-default execution context rejects", async () => {
  const f = fixture(), controller = await f.open();
  f.socket.event("Runtime.executionContextCreated", {context:{id:8,origin:ORIGIN,auxData:{isDefault:false,frameId:"frame"}}},"page");
  await expect(controller.finish()).rejects.toThrow("owned-controller:");
});
test("controller-owned expression source must match exact sent command bytes", async () => {
  const f = fixture(), controller = await f.open(); await controller.evaluate("({measured:1})");
  const [id,source] = [...f.socket.sources.entries()][0]; f.socket.sources.set(id,"x"+source.slice(1));
  await expect(controller.finish()).rejects.toThrow("controller-source-mismatch");
});
