// Falsification: target/frame/context substitution, late events, a failed socket
// and incomplete terminal cleanup must invalidate an otherwise captured byte
// snapshot. This mock boundary does not establish a real browser census.
const { test, expect } = require("@playwright/test");
const { EventEmitter } = require("node:events");
const { FlatConnection } = require("./owned-flat-cdp");
const { BodyReservations } = require("./owned-flat-body-reservations");
const { openOwnedFrontendController, controllerDiagnosticsFor } = require("./owned-flat-frontend-controller");
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
    if (this.dropMethod === packet.method) return;
    if (this.failMethod === packet.method && (this.failSession === undefined || this.failSession === packet.sessionId)) {
      queueMicrotask(() => this.emit("message", {data:JSON.stringify({id:packet.id,sessionId:packet.sessionId,error:{message:"https://secret.invalid/?token=SECRET Authorization:SECRET BODY_SECRET"}})})); return;
    }
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
    if (packet.method === "Target.getTargets" && Object.hasOwn(this,"inventoryReply") && (!this.inventoryFinalOnly || this.created)) result = this.inventoryReply;
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
  return { socket, connection, owned, open: (options = {}) => openOwnedFrontendController(owned, { documentURL: ORIGIN + "/", workerURLs: [], timeoutMs: 50, ...options }),
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

// Falsification: arbitrary protocol text, raw IDs, URLs and unknown event names
// must never escape through diagnostics; every setup stage remains fail closed.
async function rejected(promise) { try { await promise; throw Error("expected rejection"); } catch (error) { return error; } }
for (const [method, session] of [
  ["Target.getTargets"], ["Target.setDiscoverTargets"], ["Target.createBrowserContext"], ["Target.setAutoAttach",undefined],
  ["Target.createTarget"], ["Page.getFrameTree"], ["Network.enable"], ["Network.setCacheDisabled"], ["Network.setBypassServiceWorker"],
  ["Page.enable"], ["Runtime.enable"], ["Debugger.enable"], ["Fetch.enable"], ["Target.setAutoAttach","page"],
  ["Runtime.runIfWaitingForDebugger"], ["Page.navigate"],
]) test(`setup diagnostic identifies rejected ${method} ${session || "browser"} without protocol text`, async () => {
  const f = fixture(); f.socket.failMethod = method; f.socket.failSession = session;
  const error = await rejected(f.open({workerURLs:[ORIGIN+"/worker.js"]})), report = controllerDiagnosticsFor(error);
  expect(report).not.toBeNull(); expect(report.trace.some(item=>item.kind === "command" && item.command === method && item.outcome === "failed")).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/SECRET|secret.invalid|Authorization|BODY_|127\.0\.0\.1/);
  expect(error.message).toMatch(/^owned-controller:[a-z-]+$/); expect(f.connection.closed).toBe(true);
});
for (const [mode, stage, reason] of [["initial-target","initial-targets","context-not-isolated"],
  ["wrong-context-frame","document-census","document-census-mismatch"], ["missing-context","page-load","external-error"]]) {
  test(`setup diagnostic preserves fixed ${reason} and stage ${stage}`, async () => {
    const f = fixture(mode), error = await rejected(f.open()), report = controllerDiagnosticsFor(error);
    expect(report).toMatchObject({stage,reason}); expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.trace)).toBe(true); expect(report.trace.every(Object.isFrozen)).toBe(true);
  });
}
test("setup verification error is fixed and never copies arbitrary stack/cause text", async () => {
  const f = fixture(); f.owned.verify = async () => {throw Error("https://secret.invalid SECRET_BODY");};
  const error = await rejected(f.open()), report = controllerDiagnosticsFor(error);
  expect(report).toMatchObject({stage:"verify-owned",reason:"external-error"});
  expect(JSON.stringify(report)+error.message+error.stack).not.toContain("SECRET");
});
test("configuration parse errors produce an unavailable-state fixed report", async () => {
  const f = fixture(), error = await rejected(f.open({documentURL:"invalid SECRET"}));
  expect(controllerDiagnosticsFor(error)).toMatchObject({stage:"configuration",reason:"configuration-invalid",pageAttached:null,trace:[]});
  expect(error.message+error.stack+JSON.stringify(controllerDiagnosticsFor(error))).not.toContain("SECRET");
});
test("diagnostic rings and alias tables are bounded frozen copies with fixed unknown labels", async () => {
  const f = fixture(), controller = await f.open();
  for (let i=0;i<100;i++) f.socket.event("SECRET_UNKNOWN_METHOD",{requestId:`https://SECRET/${i}`,headers:{Authorization:"SECRET"},body:"SECRET"},"page");
  f.socket.event("Page.frameAttached",{frameId:"SECRET_FRAME"},"page");
  const error = await rejected(controller.finish()), report = controllerDiagnosticsFor(error), before = JSON.stringify(report);
  expect(report.trace).toHaveLength(64); expect(report.dropped).toBeGreaterThan(0); expect(report.aliases).toBe(64); expect(report.aliasOverflow).toBe(true);
  expect(report.trace.some(item=>item.event === "other")).toBe(true); expect(before).not.toMatch(/SECRET|https:|headers|body/);
  f.socket.event("SECRET_LATE",{requestId:"SECRET_LATE"},"page"); expect(JSON.stringify(report)).toBe(before);
});

test("initial frame command timeout has a fixed failed-command diagnostic", async () => {
  const f = fixture(); f.socket.dropMethod = "Page.getFrameTree";
  const error = await rejected(f.open()), report = controllerDiagnosticsFor(error);
  expect(report.stage).toBe("initial-frame");
  expect(report.trace.at(-1)).toMatchObject({kind:"command",command:"Page.getFrameTree",outcome:"failed"});
  expect(f.socket.calls.some(command=>command.method === "Runtime.runIfWaitingForDebugger")).toBe(false);
});
for (const [url, category, accepted] of [["about:blank","about-blank",true],["","empty",false],["https://SECRET.invalid/token","other",false],[undefined,"missing",false]]) {
  test(`initial page attachment ${category} is diagnosed without changing its gate`, async () => {
    const f = fixture(), original = f.socket.event.bind(f.socket);
    f.socket.event = (method,params,session) => {
      if (method === "Target.attachedToTarget") params = {...params,targetInfo:{...params.targetInfo,url}};
      original(method,params,session);
    };
    let error;
    if (accepted) { const controller = await f.open(); f.socket.event("Page.frameAttached",{},"page"); error = await rejected(controller.finish()); }
    else error = await rejected(f.open());
    const report = controllerDiagnosticsFor(error);
    expect(report.trace.find(item=>item.event === "Target.attachedToTarget")).toMatchObject({targetURLKind:category});
    expect(report.trace.find(item=>item.kind === "attachment")).toMatchObject({outcome:accepted ? "page-accepted" : "rejected"});
    expect(JSON.stringify(report)).not.toContain("SECRET");
  });
}
test("successful setup trace has every renderer ACK before initial resume", async () => {
  const f = fixture(), controller = await f.open(); f.socket.event("Page.frameAttached",{},"page");
  const report = controllerDiagnosticsFor(await rejected(controller.finish()));
  const resume = report.trace.find(item=>item.command === "Runtime.runIfWaitingForDebugger" && item.outcome === "sent");
  for (const command of ["Page.getFrameTree","Page.enable","Runtime.enable","Network.enable","Network.setCacheDisabled","Network.setBypassServiceWorker","Debugger.enable"]) {
    expect(report.trace.find(item=>item.command === command && item.outcome === "acknowledged").sequence).toBeLessThan(resume.sequence);
  }
});

// Falsification: a nonempty or malformed target inventory remains rejected;
// diagnostic array/entry limits and fixed categories cannot expose protocol data.
for (const [name, reply, shape, count] of [
  ["missing",{},"missing",null],["null",{targetInfos:null},"null",null],
  ["object",{targetInfos:{}},"object",null],["string",{targetInfos:"SECRET"},"string",null],
  ["number",{targetInfos:42},"number",null],["boolean",{targetInfos:true},"boolean",null],
]) test(`initial inventory ${name} is distinguished without weakening isolation`,async()=>{
  const f=fixture();f.socket.inventoryReply=reply;const error=await rejected(f.open()), report=controllerDiagnosticsFor(error);
  expect(report).toMatchObject({stage:"initial-targets",reason:"context-not-isolated"});
  expect(report.trace.at(-1).targetInventory).toEqual({shape,count,truncated:false,targets:[]});
  expect(JSON.stringify(report)).not.toContain("SECRET");expect(f.socket.calls.some(c=>c.method==='Target.createBrowserContext')).toBe(false);
});
test("initial nonempty inventory includes only bounded fixed metadata and opaque aliases",async()=>{
 const f=fixture();f.socket.inventoryReply={targetInfos:Array.from({length:12},(_,i)=>({targetId:`SECRET_TARGET_${i}`,type:i?'SECRET_TYPE':'browser',url:i?'https://SECRET.invalid/token':'',browserContextId:'SECRET_CONTEXT',attached:i===0,title:'SECRET_TITLE'}))};
 const error=await rejected(f.open()),report=controllerDiagnosticsFor(error),inventory=report.trace.at(-1).targetInventory;
 expect(inventory).toMatchObject({shape:'array',count:12,truncated:true});expect(inventory.targets).toHaveLength(8);
 expect(inventory.targets[0]).toMatchObject({entryShape:'object',targetIdPresent:true,targetIdValid:true,type:'browser',urlCategory:'empty',contextIdPresent:true,contextIdValid:true,contextOwnedMatch:null,attached:'true'});
 expect(inventory.targets[1]).toMatchObject({type:'other',urlCategory:'other',attached:'false'});
 expect(Object.isFrozen(inventory)).toBe(true);expect(Object.isFrozen(inventory.targets)).toBe(true);expect(inventory.targets.every(Object.isFrozen)).toBe(true);
 expect(JSON.stringify(report)).not.toMatch(/SECRET|https:/);expect(f.socket.calls.some(c=>c.method==='Target.createBrowserContext')).toBe(false);
});
test("malformed target entries and absent properties retain distinct fixed categories",async()=>{
 const f=fixture();f.socket.inventoryReply={targetInfos:[null,{},[],{targetId:42,type:false,url:null,browserContextId:7,attached:'SECRET'},{targetId:'',type:'',url:42},{type:'page',url:'about:blank'}]};
 const inventory=controllerDiagnosticsFor(await rejected(f.open())).trace.at(-1).targetInventory;
 expect(inventory.targets[0]).toMatchObject({entryShape:'null',type:'missing',urlCategory:'missing',contextIdPresent:false,attached:'missing'});
 expect(inventory.targets[2].entryShape).toBe('array');expect(inventory.targets[3]).toMatchObject({targetIdValid:false,type:'invalid',urlCategory:'null',contextIdPresent:true,contextIdValid:false,attached:'invalid'});
 expect(inventory.targets[4]).toMatchObject({targetIdPresent:true,targetIdValid:false,type:'empty',urlCategory:'invalid'});
 expect(inventory.targets[5]).toMatchObject({type:'page',urlCategory:'about-blank'});expect(JSON.stringify(inventory)).not.toContain('SECRET');
});
for(const matching of [true,false])test(`final inventory exposes owned-context match ${matching} without changing census`,async()=>{
 const f=fixture(),controller=await f.open();f.socket.inventoryFinalOnly=true;f.socket.inventoryReply={targetInfos:[{...f.socket.target(),browserContextId:matching?'context':'SECRET_FOREIGN',attached:true}, {targetId:'SECRET_UNKNOWN',type:'tab',url:'about:blank'}]};
 const report=controllerDiagnosticsFor(await rejected(controller.finish())),inventory=report.trace.filter(item=>item.targetInventory).at(-1).targetInventory;
 expect(inventory.targets[0]).toMatchObject({contextOwnedMatch:matching,attached:'true'});expect(inventory.targets[1]).toMatchObject({type:'tab',contextIdPresent:false,contextOwnedMatch:false,attached:'missing'});
 expect(report.reason).toBe('final-target-census-mismatch');expect(JSON.stringify(report)).not.toContain('SECRET');
});


// Falsification: recognizing a public component label must never admit it;
// unknown origins, credentials, encoded/suffix hosts and raw URL data stay hidden.
const componentExamples = [
 ["network-speech","fignfifoniblkonapihmkfakmlgkbkcf","service_worker.js"],
 ["glic","admccjkmockfdflocgggjfgdacdodkdf","background.js"],
 ["hangouts","nkeimhogjdpnpccoofpliimaahmaaome","thunk.js"],
];
async function observedTargetURL(url){const f=fixture();f.socket.inventoryReply={targetInfos:[{targetId:"SECRET_TARGET",type:"service_worker",url,browserContextId:"SECRET_CONTEXT",attached:false}]};
 const error=await rejected(f.open()),report=controllerDiagnosticsFor(error);expect(report.reason).toBe("context-not-isolated");
 expect(f.socket.calls.some(c=>c.method === "Target.createBrowserContext")).toBe(false);return report.trace.at(-1).targetInventory.targets[0].urlFacts;}
for(const [label,host,worker] of componentExamples)test(`public ${label} component is diagnosed while startup remains rejected`,async()=>{
 const facts=await observedTargetURL(`chrome-extension://${host}/${worker}`);
 expect(facts).toEqual({scheme:"chrome-extension",knownComponent:label,exactKnownWorkerPath:true,credentialsPresent:false,queryPresent:false,fragmentPresent:false});expect(Object.isFrozen(facts)).toBe(true);
});
for(const [name,url,scheme,label,worker] of [
 ["unknown","chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/SECRET","chrome-extension","unknown-extension",null],
 ["wrong-path","chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf/SECRET","chrome-extension","network-speech",false],
 ["query","chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf/service_worker.js?SECRET","chrome-extension","network-speech",false],
 ["fragment","chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf/service_worker.js#SECRET","chrome-extension","network-speech",false],
 ["credentials","chrome-extension://SECRET@fignfifoniblkonapihmkfakmlgkbkcf/service_worker.js","chrome-extension","unknown-extension",null],
 ["suffix","chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf.SECRET/service_worker.js","chrome-extension","unknown-extension",null],
 ["encoded-host","chrome-extension://%66ignfifoniblkonapihmkfakmlgkbkcf/service_worker.js","chrome-extension","unknown-extension",null],
 ["http","https://SECRET.invalid/","https","not-extension",null],
 ["blob","blob:https://SECRET.invalid/id","blob","not-extension",null],
 ["data","data:text/plain,SECRET","data","not-extension",null],
 ["unknown-scheme","SECRET:SECRET","other","not-extension",null],
 ["malformed","SECRET invalid","invalid","unavailable",null],
 ["oversize","SECRET".repeat(1000),"invalid","unavailable",null],
 ["missing",undefined,"missing","unavailable",null],
 ["nonstring",{SECRET:true},"invalid","unavailable",null],
])test(`target URL ${name} preserves diagnostic uncertainty and redaction`,async()=>{
 const facts=await observedTargetURL(url);expect(facts).toMatchObject({scheme,knownComponent:label,exactKnownWorkerPath:worker});
 expect(JSON.stringify(facts)).not.toMatch(/SECRET|invalid\/|fignfifoniblkonapihmkfakmlgkbkcf/);
});
