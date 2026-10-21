// Test-only protocol capability probe, never a qualification collector.
// Falsification: foreign PID/inode/session, unsafe port files, missing bootstrap,
// import/WASM bytes, wrong pause, early execution, detach and incomplete cleanup
// must fail. Unknown cache/SW flags stay unknown; mocks do not prove Chromium.
const { test, expect } = require("@playwright/test");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { FlatConnection, launchOwnedChromium, parseActivePort, processIdentity, inspectEndpointRecords,
  launchArguments, cleanupOwnedProcess, readSmall, deadline, problem, LIMITS, stderrCategory, numericObservation, helperObservation,
  collectLaunchPrerequisites, prerequisiteDiagnosticsFor, attachPrerequisites } = require("./owned-flat-cdp");

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const PORT = "42123\n/devtools/browser/12345678-abcd-abcd-abcd-123456789abc";
const stat = (pid, start = "800") => `${pid} (chrome test) S 1 ${pid} ${pid} ${Array(15).fill("0").join(" ")} ${start}`;
const row = (address = "0100007F", inode = "876", port = 42123) =>
  `0: ${address}:${port.toString(16).toUpperCase()} 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000 0 ${inode}`;
const records = (rows, sockets = ["876"], tcp6 = "header\n") => ({ port: 42123, tcp: `header\n${rows}\n`, tcp6, sockets });
class MockSocket extends EventEmitter {
  constructor() { super(); this.sent = []; this.closed = false; }
  addEventListener(name, callback) { this.on(name, callback); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.closed = true; }
  reply(value) { this.emit("message", { data: JSON.stringify(value) }); }
}

test.describe("owned flattened CDP mocks", () => {
  test("port file permits Chromium's absent final newline", () => {
    expect(parseActivePort(PORT)).toEqual({ port: 42123, url: `ws://127.0.0.1:42123${PORT.split("\n")[1]}` });
    expect(parseActivePort(`${PORT}\n`)).toEqual(parseActivePort(PORT));
  });
  for (const value of ["0", "65536", "042123", "42123\nws://user:token@127.0.0.1/a", `${PORT}\n\n`, `${PORT}?token=x`, `${PORT}\0`]) {
    test(`rejects malformed endpoint ${JSON.stringify(value)}`, () => expect(() => parseActivePort(value)).toThrow("endpoint-file-invalid"));
  }
  test("joins namespace listener to exact process FD inode", () => {
    expect(inspectEndpointRecords(records(row()))).toBe("876");
    expect(() => inspectEndpointRecords(records(row(), ["999"]))).toThrow("not-owned-by-process");
  });
  for (const address of ["00000000", "0100000A", "0200007F"]) {
    test(`rejects non-authorized listener ${address}`, () => expect(() => inspectEndpointRecords(records(row(address)))).toThrow("unique-ipv4-loopback"));
  }
  test("rejects ambiguous and IPv6 same-port listeners", () => {
    expect(() => inspectEndpointRecords(records(`${row()}\n${row()}`))).toThrow("listener-ambiguous");
    expect(() => inspectEndpointRecords(records(row(), ["876"], `header\n${row("00000000000000000000000001000000")}\n`))).toThrow("unique-ipv4-loopback");
  });
  test("requires owned process group and starttime", () => {
    expect(processIdentity(stat(123), 123)).toEqual({ pid: 123, start: "800", group: 123 });
    expect(() => processIdentity(stat(124), 123)).toThrow("process-stat-invalid");
    expect(() => processIdentity(stat(123).replace("S 1 123", "S 1 456"), 123)).toThrow("process-group-invalid");
  });
  test("metadata read rejects symlink, directory and oversize", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "owned-cdp-mock-"));
    try {
      await fs.writeFile(path.join(root, "file"), "tiny");
      await fs.symlink(path.join(root, "file"), path.join(root, "link"));
      await expect(readSmall(path.join(root, "link"), 8, true)).rejects.toThrow();
      await expect(readSmall(root, 8, true)).rejects.toThrow("metadata-file-invalid");
      await expect(readSmall(path.join(root, "file"), 3, true)).rejects.toThrow("metadata-file-invalid");
      expect((await readSmall(path.join(root, "file"), 4, true)).text).toBe("tiny");
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
  test("launch arguments never relax the sandbox or allow remote origins", () => {
    const args = launchArguments("/owned/fresh");
    expect(args).toContain("--remote-debugging-address=127.0.0.1");
    expect(args.some(arg => /no-sandbox|disable-setuid-sandbox|remote-allow-origins|disable-web-security/.test(arg))).toBe(false);
  });
  test("routes public flattened command reply by exact session", async () => {
    const socket = new MockSocket(); const connection = new FlatConnection(socket);
    const task = connection.send("Network.enable", {}, "worker-1");
    expect(socket.sent[0]).toEqual({ id: 1, method: "Network.enable", params: {}, sessionId: "worker-1" });
    socket.reply({ id: 1, sessionId: "worker-1", result: {} }); await task; connection.close();
  });
  for (const reply of [{ id: 1, sessionId: "foreign", result: {} }, { id: 1, result: {} }, { id: 99, result: {} }]) {
    test(`rejects wrong reply ownership ${JSON.stringify(reply)}`, async () => {
      const socket = new MockSocket(); const connection = new FlatConnection(socket);
      const task = connection.send("Network.enable", {}, "worker-1");
      socket.reply(reply); await expect(task).rejects.toThrow("reply-ownership-mismatch"); connection.close();
    });
  }
  test("protocol error text cannot escape and timeout fails all pending commands", async () => {
    const socket = new MockSocket(); const connection = new FlatConnection(socket, { commandMs: 10 });
    const task = connection.send("Network.enable");
    socket.reply({ id: 1, error: { message: "https://secret.test/?token=private", data: "body" } });
    await expect(task).rejects.toThrow(/^owned-cdp:command-rejected$/); connection.close();
    const second = new FlatConnection(new MockSocket(), { commandMs: 5 });
    await expect(second.send("Network.enable")).rejects.toThrow(/^owned-cdp:command-timeout$/); second.close();
  });
  for (const commandMs of [0, -1, Infinity, NaN, 3001]) {
    test(`rejects unbounded command timeout ${commandMs}`, () => expect(() => new FlatConnection(new MockSocket(), { commandMs })).toThrow("deadline-invalid"));
  }
  test("rejects oversized accepted frame before parsing", () => {
    const connection = new FlatConnection(new MockSocket()); connection.receive(" ".repeat(LIMITS.frameBytes + 1));
    expect(connection.failure.message).toBe("owned-cdp:frame-bound"); connection.close();
  });
  test("cleanup observes actual exit rather than killed flag", async () => {
    const child = { pid: 123, exitCode: null, signalCode: null, killed: true };
    const signals = []; let waits = 0;
    await cleanupOwnedProcess({ child, identity: { start: "800" }, exited: Promise.resolve(), endpoint: { inode: "876" } }, {
      snapshot: async () => ({ start: "800" }), groupSignal: (pid, name) => signals.push([pid, name]),
      wait: async () => { waits++; child.signalCode = "SIGTERM"; }, listenerPresent: async () => false, groupPresent: () => false,
    });
    expect(signals).toEqual([[-123, "SIGTERM"]]); expect(waits).toBe(1);
  });
  test("cleanup never signals a replaced process or stale exited group", async () => {
    const child = { pid: 123, exitCode: null, signalCode: null }; let signals = 0;
    const io = { snapshot: async () => ({ start: "900" }), groupSignal: () => signals++, wait: async () => {}, listenerPresent: async () => false, groupPresent: () => false };
    await expect(cleanupOwnedProcess({ child, identity: { start: "800" } }, io)).rejects.toThrow("ownership-lost");
    child.exitCode = 0; await cleanupOwnedProcess({ child, identity: { start: "800" } }, io); expect(signals).toBe(0);
  });
  test("partial startup still terminates direct child and reports unverified cleanup", async () => {
    const names = []; const child = { pid: 123, exitCode: null, signalCode: null, kill: name => names.push(name) };
    await expect(cleanupOwnedProcess({ child, exited: Promise.resolve() }, {
      groupSignal: () => { throw new Error("must not signal group"); },
      wait: async () => { child.signalCode = "SIGTERM"; },
    })).rejects.toThrow("cleanup-preidentity-unverified");
    expect(names).toEqual(["SIGTERM"]);
  });
  test("surviving listener and unobserved exit fail cleanup", async () => {
    const child = { pid: 123, exitCode: 0, signalCode: null };
    await expect(cleanupOwnedProcess({ child, identity: { start: "800" }, endpoint: { inode: "876" } }, {
      listenerPresent: async () => true,
    })).rejects.toThrow("listener-survived");
    child.exitCode = null;
    await expect(cleanupOwnedProcess({ child, identity: { start: "800" } }, {
      snapshot: async () => ({ start: "800" }), groupSignal: () => {}, wait: async () => {},
    })).rejects.toThrow("exit-unobserved");
  });
});

const BOOTSTRAP = Buffer.from('importScripts("/worker-import.js");\nWebAssembly.instantiateStreaming(fetch("/worker.wasm")).then(() => postMessage("owned-worker-done"));\n');
const IMPORT = Buffer.from('self.importWasExecuted = true;\n');
const WASM = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
const BODIES = { "/bootstrap.js": BOOTSTRAP, "/worker-import.js": IMPORT, "/worker.wasm": WASM };
const CONTROL_NAMES = ["Network.enable", "Network.setCacheDisabled", "Network.setBypassServiceWorker"];
function newFacts() {
  return { profile: "owned-flat-cdp-startup-probe/1", completeCoverage: false, collectorProofEstablished: false,
    stage: "launch", childSetupAcksBeforeFirstResume: 0, setupAcksBeforeFinalResume: false, instrumentationPauseObserved: false,
    pauseSourceMatchesBootstrap: false, creatorFetchBodyMatches: false, continuedWithoutOverrides: false,
    importBodyMatches: false, wasmBodyMatches: false, workerMessageObserved: false,
    earlyImportOrWasm: false, networkResponseSeen: false, fromDiskCache: null, fromPrefetchCache: null,
    fromServiceWorker: null, freshContextCreated: false, cacheDisabledAcknowledged: false,
    bypassServiceWorkerAcknowledged: false, cacheFactsScope: "bootstrap-only", bootstrapServedFromCacheEvent: false,
    endpointReverified: false, cleanupVerified: false, probeSucceeded: false, errorCode: null, capability: "unestablished", startupTrace: null };
}
function recordBootstrapFlags(facts, response) {
  // Reject a second response rather than allowing migration/repetition to erase
  // true or unknown evidence. These fields describe only the bootstrap.
  if (facts.networkResponseSeen) throw problem("probe-duplicate-bootstrap-response");
  facts.networkResponseSeen = true;
  for (const name of ["fromDiskCache", "fromPrefetchCache", "fromServiceWorker"]) {
    facts[name] = typeof response?.[name] === "boolean" ? response[name] : null;
  }
}
function assertProbeEvidence(facts) {
  for (const name of ["setupAcksBeforeFinalResume", "instrumentationPauseObserved", "pauseSourceMatchesBootstrap",
    "creatorFetchBodyMatches", "continuedWithoutOverrides", "importBodyMatches", "wasmBodyMatches", "workerMessageObserved",
    "freshContextCreated", "cacheDisabledAcknowledged", "bypassServiceWorkerAcknowledged"]) {
    if (facts[name] !== true) throw problem("probe-evidence-incomplete");
  }
  if (facts.earlyImportOrWasm) throw problem("execution-before-owned-release");
  return facts;
}
for (const missing of ["creatorFetchBodyMatches", "importBodyMatches", "wasmBodyMatches", "instrumentationPauseObserved", "workerMessageObserved"]) {
  test(`owned probe rejects missing ${missing}`, () => {
    const facts = newFacts(); for (const key of Object.keys(facts)) if (typeof facts[key] === "boolean") facts[key] = true;
    facts.earlyImportOrWasm = false; facts[missing] = false;
    expect(() => assertProbeEvidence(facts)).toThrow("probe-evidence-incomplete");
  });
}
test("owned probe preserves unknown provenance separately from acknowledged controls", () => {
  const facts = newFacts(); facts.cacheDisabledAcknowledged = true; facts.bypassServiceWorkerAcknowledged = true;
  expect([facts.fromDiskCache, facts.fromPrefetchCache, facts.fromServiceWorker]).toEqual([null, null, null]);
  expect(facts.completeCoverage).toBe(false); expect(facts.collectorProofEstablished).toBe(false);
});

// Diagnostic-only aliases never expose raw IDs. The map and ring are bounded;
// no URL, header, response body, arbitrary method, or exception is retained.
function startupTrace() {
  const methods = new Set(["Target.createBrowserContext", "Target.setAutoAttach", "Target.createTarget", "Target.attachedToTarget",
    "Target.detachedFromTarget", "Target.targetCrashed", "Inspector.detached", "Network.enable", "Network.setCacheDisabled",
    "Network.setBypassServiceWorker", "Network.requestWillBeSent", "Network.responseReceived", "Network.requestServedFromCache",
    "Network.loadingFinished", "Network.loadingFailed", "Network.getResponseBody", "Fetch.enable", "Fetch.requestPaused",
    "Fetch.getResponseBody", "Fetch.continueRequest", "Runtime.enable", "Runtime.runIfWaitingForDebugger", "Runtime.consoleAPICalled",
    "Page.enable", "Page.navigate", "Debugger.enable", "Debugger.setInstrumentationBreakpoint", "Debugger.scriptParsed",
    "Debugger.paused", "Debugger.resumed", "Debugger.getScriptSource", "Debugger.removeBreakpoint", "Debugger.resume",
    "probe.worker-setup", "probe.bootstrap-fetch", "probe.bootstrap-instrumentation", "probe.import-body"]);
  const ids = new Map(), events = []; let sequence = 0, dropped = 0, identityLimitReached = false;
  const alias = value => {
    if (typeof value !== "string" || !value || value.length > 128) return null;
    if (!ids.has(value)) {
      if (ids.size === 32) { identityLimitReached = true; return null; }
      ids.set(value, `i${ids.size + 1}`);
    }
    return ids.get(value);
  };
  return {
    record(method, phase, session, p = {}, state = {}) {
      const checks = { pagePresent: typeof state.page === "string", workerPresent: typeof state.worker === "string",
        originalPresent: typeof state.original === "string", workerTargetPresent: typeof state.workerTarget === "string",
        sessionIsPage: session === state.page, sessionIsWorker: session === state.worker };
      if (phase === "event") {
        const bootstrapUrlMatches = p.request?.url === `${state.origin}/bootstrap.js`;
        if (method === "Target.attachedToTarget") Object.assign(checks, {
          rootSession: !session, targetIsPage: p.targetInfo?.type === "page", targetIsWorker: p.targetInfo?.type === "worker",
          pageAbsent: !state.page, workerAbsent: !state.worker, childSessionIsString: typeof p.sessionId === "string",
          contextMatches: p.targetInfo?.browserContextId === state.context, parentMatchesPage: p.targetInfo?.parentId === state.pageTarget,
          targetEqualsOriginal: p.targetInfo?.targetId === state.original, waitingForDebugger: p.waitingForDebugger === true });
        if (method === "Network.requestWillBeSent") Object.assign(checks, {
          bootstrapUrlMatches, getMethod: p.request?.method === "GET", redirectAbsent: !p.redirectResponse, originalAbsent: !state.original });
        if (method === "Fetch.requestPaused") Object.assign(checks, {
          firstPauseCandidate: state.pauseCount + 1 === 1, networkIdEqualsOriginal: p.networkId === state.original,
          originalEqualsWorkerTarget: state.original === state.workerTarget, bootstrapUrlMatches, getMethod: p.request?.method === "GET",
          status200: p.responseStatusCode === 200, responseErrorAbsent: !p.responseErrorReason, redirectedRequestAbsent: !p.redirectedRequestId,
          responseHeadersArray: Array.isArray(p.responseHeaders), responseHeadersWithinBound: Array.isArray(p.responseHeaders) && p.responseHeaders.length <= 32 });
        if (method === "Debugger.paused") Object.assign(checks, {
          firstInstrumentationPause: !state.facts?.instrumentationPauseObserved, instrumentationReason: p.reason === "instrumentation",
          scriptIdIsString: typeof p.data?.scriptId === "string", callFrameScriptMatches: p.callFrames?.[0]?.location?.scriptId === p.data?.scriptId,
          hitBreakpointsEmpty: Array.isArray(p.hitBreakpoints) && p.hitBreakpoints.length === 0, oneParsedScript: state.scripts?.length === 1,
          initialScriptMatches: state.scripts?.[0]?.id === p.data?.scriptId, initialScriptUrlMatches: state.scripts?.[0]?.url === `${state.origin}/bootstrap.js` });
        if (method === "Debugger.scriptParsed") checks.scriptWithinBound = state.scripts?.length < 8;
        if (method === "Debugger.resumed") checks.finalReleaseSent = state.facts?.setupAcksBeforeFinalResume === true;
        if (["Network.responseReceived", "Network.loadingFinished"].includes(method)) {
          const entry = state.requests?.get(p.requestId);
          Object.assign(checks, { requestEqualsOriginal: p.requestId === state.original, requestTracked: Boolean(entry),
            responseAlreadySeen: entry?.response === true, completionAlreadySeen: entry?.completed === true,
            status200: p.response?.status === 200, responseUrlMatches: Boolean(entry) && p.response?.url === state.origin + entry.key });
        }
      }
      const event = Object.freeze({ sequence: sequence = Math.min(sequence + 1, 1024), method: methods.has(method) ? method : "other",
        phase: ["event", "send", "ack", "reject"].includes(phase) ? phase : "other", session: alias(session),
        childSession: alias(p.sessionId), request: alias(p.requestId), network: alias(p.networkId),
        target: alias(p.targetInfo?.targetId), parent: alias(p.targetInfo?.parentId),
        expectedOriginal: alias(state.original), expectedWorkerTarget: alias(state.workerTarget), checks: Object.freeze(checks) });
      events.push(event); if (events.length > 32) { events.shift(); dropped = Math.min(dropped + 1, 1024); }
    },
    snapshot() { return Object.freeze({ events: Object.freeze([...events]), droppedEvents: dropped, identityLimitReached }); },
  };
}

async function startupProbe(connection, origin, serverCounts, { firstDelayMs = 150, holdDelayMs = 100, completionMs = 10000, facts = newFacts() } = {}) { let context, page, pageTarget, worker, workerTarget, original, pauseCount = 0;
  let released = false, setup = [], breakpoint, failure, eventCount = 0, finished = false;
  const requests = new Map(), scripts = []; const tasks = new Set();
  const trace = startupTrace();
  const traceState = () => ({ context, page, pageTarget, worker, workerTarget, original, pauseCount, origin, requests, scripts, facts });
  let resolveDone, rejectDone; const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Prevent a rejection before the finish waiter is installed becoming unhandled.
  done.catch(() => {});
  const fail = code => { if (!failure) { failure = problem(code); rejectDone(failure); } };
  const maybeDone = () => {
    if (facts.workerMessageObserved && facts.creatorFetchBodyMatches && facts.continuedWithoutOverrides && facts.importBodyMatches && facts.wasmBodyMatches) resolveDone();
  };
  const task = (promise, label, session) => { tasks.add(promise); promise.catch(() => {
    trace.record(label, "reject", session, {}, traceState()); fail("probe-protocol-operation-failed");
  }).finally(() => tasks.delete(promise)); };
  const dispatch = (method, params = {}, session) => {
    trace.record(method, "send", session, {}, traceState());
    return connection.send(method, params, session).then(result => {
      trace.record(method, "ack", session, {}, traceState()); return result;
    }, error => { trace.record(method, "reject", session, {}, traceState()); throw error; });
  };
  const send = (method, params = {}, session = page) => dispatch(method, params, session);
  const controls = session => CONTROL_NAMES.map((name, index) => send(name, index === 1 ? { cacheDisabled: true } : index === 2 ? { bypass: true } : {}, session));
  const decode = (response, expected) => {
    if (typeof response.body !== "string" || response.body.length > 8192 || typeof response.base64Encoded !== "boolean") throw problem("body-shape-invalid");
    const bytes = Buffer.from(response.body, response.base64Encoded ? "base64" : "utf8");
    if (response.base64Encoded && bytes.toString("base64") !== response.body) throw problem("body-base64-invalid");
    if (bytes.length > 4096 || !bytes.equals(expected)) throw problem("body-mismatch");
  };
  const onEvent = event => {
    if (failure || finished) return;
    if (++eventCount > 256) { fail("probe-event-bound"); return; }
    const { method, params: p, sessionId: session } = event;
    trace.record(method, "event", session, p, traceState());
    if (["Target.detachedFromTarget", "Target.targetCrashed", "Inspector.detached"].includes(method)) { fail("probe-target-lifecycle-lost"); return; }
    if (method === "Target.attachedToTarget") {
      if (!session && p.targetInfo?.type === "page" && !page && p.targetInfo.browserContextId === context && p.waitingForDebugger === true) {
        page = p.sessionId; pageTarget = p.targetInfo.targetId; return;
      }
      if (session !== page || worker || p.targetInfo?.type !== "worker" || p.targetInfo.parentId !== pageTarget ||
          p.targetInfo.targetId !== original || p.waitingForDebugger !== true || typeof p.sessionId !== "string") { fail("probe-worker-owner-mismatch"); return; }
      worker = p.sessionId; workerTarget = p.targetInfo.targetId; facts.stage = "worker-attached";
      task((async () => {
        setup = controls(worker).map(promise => promise.then(value => { if (!released) facts.childSetupAcksBeforeFirstResume++; return value; }));
        // Register the second execution gate before queuing the first resume.
        setup.push(send("Debugger.enable", {}, worker));
        const install = send("Debugger.setInstrumentationBreakpoint", { instrumentation: "beforeScriptExecution" }, worker);
        setup.push(install); setup.forEach(promise => promise.catch(() => fail("probe-child-setup-failed"))); install.then(value => { breakpoint = value.breakpointId; }, () => {});
        // This interval measures the actual fetch-throttle/renderer dependency.
        await wait(firstDelayMs);
        facts.childSetupAcksBeforeFirstResume = Math.min(facts.childSetupAcksBeforeFirstResume, 3);
        released = true; facts.stage = "first-resume-sent";
        await send("Runtime.runIfWaitingForDebugger", {}, worker);
      })(), "probe.worker-setup", worker); return;
    }
    if (session !== page && session !== worker) return;
    if (method === "Network.requestWillBeSent") {
      if (session === page && p.request?.url === `${origin}/bootstrap.js`) {
        if (original || p.redirectResponse || p.request.method !== "GET") { fail("probe-bootstrap-request-invalid"); return; }
        original = p.requestId; return;
      }
      if (session === worker && p.request?.url !== `${origin}/bootstrap.js`) {
        const key = Object.keys(BODIES).find(name => name !== "/bootstrap.js" && p.request?.url === origin + name);
        if (!key || requests.size >= 2 || requests.has(p.requestId) || [...requests.values()].some(value => value.key === key) || p.redirectResponse || p.request.method !== "GET") { fail("probe-import-request-invalid"); return; }
        if (!facts.setupAcksBeforeFinalResume) { facts.earlyImportOrWasm = true; fail("execution-before-owned-release"); return; }
        requests.set(p.requestId, { key, response: false, completed: false }); return;
      }
    }
    if (method === "Network.responseReceived") {
      if (p.requestId === original) recordBootstrapFlags(facts, p.response);
      const entry = requests.get(p.requestId);
      if (entry && session === worker) {
        if (entry.response || p.response?.status !== 200 || p.response.url !== origin + entry.key) { fail("probe-import-response-invalid"); return; }
        entry.response = true;
      }
    }
    if (method === "Network.requestServedFromCache" && p.requestId === original) facts.bootstrapServedFromCacheEvent = true;
    if (method === "Fetch.requestPaused") {
      if (session !== page || ++pauseCount !== 1 || p.networkId !== original || original !== workerTarget ||
          p.request?.url !== `${origin}/bootstrap.js` || p.request.method !== "GET" || p.responseStatusCode !== 200 || p.responseErrorReason ||
          p.redirectedRequestId || !Array.isArray(p.responseHeaders) || p.responseHeaders.length > 32) { fail("probe-fetch-owner-mismatch"); return; }
      facts.stage = "bootstrap-fetch-paused";
      task((async () => {
        decode(await send("Fetch.getResponseBody", { requestId: p.requestId }), BOOTSTRAP);
        facts.creatorFetchBodyMatches = true; facts.stage = "bootstrap-body-captured";
        await send("Fetch.continueRequest", { requestId: p.requestId }); facts.continuedWithoutOverrides = true; maybeDone();
      })(), "probe.bootstrap-fetch", page); return;
    }
    if (session === worker && method === "Debugger.scriptParsed") {
      if (scripts.length >= 8) { fail("probe-script-bound"); return; }
      scripts.push({ id: p.scriptId, url: p.url });
    }
    if (session === worker && method === "Debugger.paused") {
      if (facts.instrumentationPauseObserved || p.reason !== "instrumentation" || typeof p.data?.scriptId !== "string" ||
          p.callFrames?.[0]?.location?.scriptId !== p.data.scriptId || !Array.isArray(p.hitBreakpoints) || p.hitBreakpoints.length ||
          scripts.length !== 1 || scripts[0].id !== p.data.scriptId || scripts[0].url !== `${origin}/bootstrap.js`) { fail("probe-bootstrap-pause-invalid"); return; }
      facts.instrumentationPauseObserved = true; facts.stage = "instrumentation-paused";
      task((async () => {
        await Promise.all(setup); facts.stage = "child-setup-acknowledged";
        const source = await send("Debugger.getScriptSource", { scriptId: p.data.scriptId }, worker);
        if (source.scriptSource !== BOOTSTRAP.toString("ascii")) throw problem("probe-bootstrap-source-mismatch");
        facts.pauseSourceMatchesBootstrap = true;
        if (typeof breakpoint !== "string") throw problem("probe-breakpoint-missing");
        await send("Debugger.removeBreakpoint", { breakpointId: breakpoint }, worker);
        // Deliberate second delay: no immediate imports/WASM may run while held.
        await wait(holdDelayMs);
        if (requests.size || serverCounts["/worker-import.js"] || serverCounts["/worker.wasm"] || facts.workerMessageObserved) throw problem("execution-before-owned-release");
        facts.cacheDisabledAcknowledged = true; facts.bypassServiceWorkerAcknowledged = true;
        facts.setupAcksBeforeFinalResume = true; facts.stage = "final-resume-sent";
        await send("Debugger.resume", {}, worker);
      })(), "probe.bootstrap-instrumentation", worker); return;
    }
    if (session === worker && method === "Debugger.resumed" && !facts.setupAcksBeforeFinalResume) { fail("probe-unsolicited-resume"); return; }
    if (method === "Network.loadingFailed") { fail("probe-network-failed"); return; }
    if (session === worker && method === "Network.loadingFinished" && requests.has(p.requestId)) {
      const entry = requests.get(p.requestId);
      if (!entry.response || entry.completed) { fail("probe-import-completion-invalid"); return; }
      entry.completed = true;
      task((async () => {
        decode(await send("Network.getResponseBody", { requestId: p.requestId }, worker), BODIES[entry.key]);
        facts[entry.key === "/worker.wasm" ? "wasmBodyMatches" : "importBodyMatches"] = true; maybeDone();
      })(), "probe.import-body", worker);
    }
    if (session === page && method === "Runtime.consoleAPICalled" && p.type === "log" && p.args?.length === 1 && p.args[0].value === "owned-worker-done") {
      if (facts.workerMessageObserved || !facts.setupAcksBeforeFinalResume) { fail("probe-worker-message-invalid"); return; }
      facts.workerMessageObserved = true; maybeDone();
    }
  };
  const listener = event => { try { onEvent(event); } catch { fail("probe-event-invalid"); } };
  const transportFailed = () => fail("probe-transport-failed");
  connection.on("event", listener); connection.on("failure", transportFailed);
  try {
    context = (await dispatch("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
    if (typeof context !== "string") throw problem("probe-context-missing"); facts.freshContextCreated = true;
    await dispatch("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: "page", exclude: false }, { exclude: true }] });
    facts.stage = "page-setup";
    const target = await dispatch("Target.createTarget", { url: "about:blank", browserContextId: context });
    if (!page || target.targetId !== pageTarget) throw problem("probe-page-attachment-missing");
    await Promise.all([...controls(page), send("Runtime.enable"), send("Page.enable"),
      send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/bootstrap.js`, requestStage: "Response" }] }),
      send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
        filter: [{ type: "worker", exclude: false }, { exclude: true }] })]);
    await send("Runtime.runIfWaitingForDebugger");
    await send("Page.navigate", { url: `${origin}/` });
    await deadline(done, completionMs, "probe-capability-timeout");
    await deadline(Promise.all([...tasks]), 3000, "probe-drain-timeout");
    if (failure) throw failure;
    assertProbeEvidence(facts);
    for (const key of Object.keys(BODIES)) if (serverCounts[key] !== 1) throw problem("probe-server-count-mismatch");
    facts.capability = "classic-bootstrap-second-gate-observed"; facts.stage = "protocol-evidence-complete";
    return facts;
  } finally {
    facts.startupTrace = trace.snapshot();
    finished = true; connection.off("event", listener); connection.off("failure", transportFailed);
    // Owned browser teardown removes the fresh context even if a session failed.

  }
}

// Executes the actual probe event handlers, without a browser or a socket.
class ProbeProtocolMock extends EventEmitter {
  constructor(mode = "valid") { super(); this.mode = mode; this.commands = []; this.queued = []; this.counts = {}; }
  event(method, params, sessionId = "page") { this.emit("event", { method, params, sessionId: sessionId === null ? undefined : sessionId }); }
  async send(method, params = {}, session) {
    this.commands.push({ method, params, session });
    if (method === "Target.createBrowserContext") return { browserContextId: "context" };
    if (method === "Target.createTarget") {
      this.event("Target.attachedToTarget", { sessionId: "page", waitingForDebugger: true,
        targetInfo: { targetId: "page-target", type: "page", browserContextId: "context" } }, null);
      return { targetId: "page-target" };
    }
    if (method === "Page.navigate") {
      this.event("Network.requestWillBeSent", { requestId: "bootstrap-id", request: { url: "http://fixture/bootstrap.js", method: "GET" } });
      if (this.mode === "fetch-before-attach") this.event("Fetch.requestPaused", { requestId: "fetch-id", networkId: "bootstrap-id",
        request: { url: "http://fixture/bootstrap.js", method: "GET" }, responseStatusCode: 200, responseHeaders: [] });
      this.event("Target.attachedToTarget", { sessionId: "worker", waitingForDebugger: true,
        targetInfo: { type: "worker", parentId: this.mode === "foreign-parent" ? "foreign" : "page-target", targetId: "bootstrap-id" } });
      return {};
    }
    if (session === "worker" && [...CONTROL_NAMES, "Debugger.enable", "Debugger.setInstrumentationBreakpoint"].includes(method)) {
      return new Promise(resolve => this.queued.push(() => resolve(method === "Debugger.setInstrumentationBreakpoint" ? { breakpointId: "breakpoint" } : {})));
    }
    if (session === "worker" && method === "Runtime.runIfWaitingForDebugger") {
      if (this.mode !== "missing-bootstrap") this.event("Fetch.requestPaused", { requestId: "fetch-id", networkId: "bootstrap-id",
        request: { url: "http://fixture/bootstrap.js", method: "GET" }, responseStatusCode: 200, responseHeaders: [] });
      return {};
    }
    if (method === "Fetch.getResponseBody") return { base64Encoded: true, body: (this.mode === "wrong-bootstrap-body" ? IMPORT : BOOTSTRAP).toString("base64") };
    if (method === "Fetch.continueRequest") {
      this.counts["/bootstrap.js"] = 1; this.queued.forEach(resolve => resolve());
      if (this.mode === "early-import") this.asset("/worker-import.js", "import-id");
      this.event("Debugger.scriptParsed", { scriptId: "script", url: "http://fixture/bootstrap.js" }, "worker");
      this.event("Debugger.paused", { reason: this.mode === "wrong-pause" ? "other" : "instrumentation", data: { scriptId: "script" },
        callFrames: [{ location: { scriptId: "script" } }], hitBreakpoints: [] }, "worker");
      return {};
    }
    if (method === "Debugger.getScriptSource") return { scriptSource: BOOTSTRAP.toString("ascii") };
    if (method === "Debugger.resume") {
      this.event("Debugger.resumed", {}, "worker");
      if (this.mode === "detach") this.event("Target.detachedFromTarget", { sessionId: "worker" });
      if (this.mode === "late-worker") this.event("Target.attachedToTarget", { sessionId: "late", waitingForDebugger: true,
        targetInfo: { type: "worker", parentId: "page-target", targetId: "late" } });
      if (this.mode === "message-before-bodies") this.event("Runtime.consoleAPICalled", { type: "log", args: [{ value: "owned-worker-done" }] });
      if (this.mode === "message-before-bodies") await wait(2);
      if (this.mode !== "missing-import") this.asset("/worker-import.js", "import-id");
      if (this.mode !== "missing-wasm") this.asset("/worker.wasm", "wasm-id");
      if (this.mode !== "message-before-bodies") this.event("Runtime.consoleAPICalled", { type: "log", args: [{ value: "owned-worker-done" }] });
      return {};
    }
    if (method === "Network.getResponseBody") {
      if (this.mode === "missing-body") throw new Error("untrusted https://host/?token=secret body");
      return { base64Encoded: true, body: (params.requestId === "wasm-id" ? WASM : IMPORT).toString("base64") };
    }
    return {};
  }
  asset(key, id) {
    this.counts[key] = (this.counts[key] || 0) + 1;
    this.event("Network.requestWillBeSent", { requestId: id, request: { url: `http://fixture${key}`, method: "GET" } }, "worker");
    this.event("Network.responseReceived", { requestId: id, response: { status: 200, url: `http://fixture${key}` } }, "worker");
    this.event("Network.loadingFinished", { requestId: id }, "worker");
  }
}
const MOCK_TIMING = { firstDelayMs: 1, holdDelayMs: 1, completionMs: 50, diagnostics: false };
test("owned probe actual handlers distinguish throttle release from final execution release", async () => {
  const connection = new ProbeProtocolMock();
  const facts = await startupProbe(connection, "http://fixture", connection.counts, MOCK_TIMING);
  expect(facts.childSetupAcksBeforeFirstResume).toBe(0);
  expect(facts.capability).toBe("classic-bootstrap-second-gate-observed");
  expect(facts.completeCoverage).toBe(false); expect(facts.fromServiceWorker).toBe(null);
  const commands = connection.commands.filter(value => value.session === "worker").map(value => value.method);
  expect(commands.indexOf("Debugger.setInstrumentationBreakpoint")).toBeLessThan(commands.indexOf("Runtime.runIfWaitingForDebugger"));
  expect(commands.indexOf("Debugger.removeBreakpoint")).toBeLessThan(commands.indexOf("Debugger.resume"));
  expect(connection.commands.find(value => value.method === "Fetch.continueRequest").params).toEqual({ requestId: "fetch-id" });
});
test("owned probe waits for response bodies after cross-session page completion", async () => {
  const connection = new ProbeProtocolMock("message-before-bodies");
  const facts = await startupProbe(connection, "http://fixture", connection.counts, MOCK_TIMING);
  expect(facts.importBodyMatches && facts.wasmBodyMatches && facts.workerMessageObserved).toBe(true);
});
for (const mode of ["foreign-parent", "missing-bootstrap", "wrong-bootstrap-body", "wrong-pause", "early-import", "detach", "late-worker", "missing-import", "missing-wasm", "missing-body"]) {
  test(`owned probe actual handlers reject ${mode}`, async () => {
    const connection = new ProbeProtocolMock(mode);
    await expect(startupProbe(connection, "http://fixture", connection.counts, MOCK_TIMING)).rejects.toThrow(/^owned-cdp:[a-z-]+$/);
  });
}
test("cleanup rejects a surviving group even after leader and listener exit", async () => {
  await expect(cleanupOwnedProcess({ child: { pid: 123, exitCode: 0, signalCode: null }, identity: { start: "800" }, endpoint: { inode: "876" } }, {
    listenerPresent: async () => false, groupPresent: () => true, pause: async () => { throw problem("cleanup-process-group-survived"); },
  })).rejects.toThrow("cleanup-process-group-survived");
});
test("no-follow bounded metadata rejects an actual FIFO without waiting for a writer", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "owned-cdp-fifo-"));
  try {
    const fifo = path.join(root, "DevToolsActivePort");
    require("node:child_process").execFileSync("mkfifo", [fifo]);
    await expect(deadline(readSmall(fifo, 512, true), 200, "fifo-read-timeout")).rejects.toThrow("metadata-file-invalid");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

for (const second of [{ fromDiskCache: false }, {}]) {
  test(`bootstrap true then ${JSON.stringify(second)} cannot erase provenance`, () => {
    const facts = newFacts(); recordBootstrapFlags(facts, { fromDiskCache: true });
    expect(() => recordBootstrapFlags(facts, second)).toThrow("duplicate-bootstrap-response");
    expect(facts.fromDiskCache).toBe(true); expect(facts.fromServiceWorker).toBe(null);
  });
}
test("cleanup permits bounded normal group reaping without signaling an exited leader", async () => {
  let checks = 0, pauses = 0;
  await cleanupOwnedProcess({ child: { pid: 123, exitCode: 0, signalCode: null }, identity: { start: "800" } }, {
    groupPresent: () => ++checks < 3, pause: async () => pauses++, groupSignal: () => { throw new Error("stale group signal"); },
  });
  expect(pauses).toBe(2);
});

test.describe("bounded all-startup rejection trace", () => {
  test("aliases and fixed checks redact arbitrary protocol data and bound map/ring", () => {
    const trace = startupTrace(), secret = "https://secret.invalid/?token=private";
    for (let i = 0; i < 100; i++) trace.record(secret, secret, `session-${i}`, {
      requestId: `request-${i}`, networkId: secret, request: { url: secret, body: secret }, responseHeaders: [{ name: secret, value: secret }], error: secret,
    });
    const snapshot = trace.snapshot();
    expect(snapshot.events).toHaveLength(32); expect(snapshot.droppedEvents).toBe(68); expect(snapshot.identityLimitReached).toBe(true);
    expect(snapshot.events.every(event => event.method === "other" && event.phase === "other")).toBe(true);
    expect(JSON.stringify(snapshot)).not.toMatch(/secret|private|token|https|request-[0-9]|session-[0-9]/);
    expect(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.events) && Object.isFrozen(snapshot.events[0]) && Object.isFrozen(snapshot.events[0].checks)).toBe(true);
    trace.record("Fetch.requestPaused", "event", "later"); expect(snapshot.events).toHaveLength(32); expect(snapshot.droppedEvents).toBe(68);
  });
  test("exact equality and ID aliases identify original/target association without raw IDs", () => {
    const trace = startupTrace();
    trace.record("Fetch.requestPaused", "event", "owned-page", { requestId: "interception", networkId: "bootstrap-original",
      request: { url: "http://fixture/bootstrap.js", method: "GET" }, responseStatusCode: 200, responseHeaders: [] },
    { page: "owned-page", worker: "owned-worker", original: "bootstrap-original", workerTarget: "bootstrap-original", pauseCount: 0, origin: "http://fixture" });
    const event = trace.snapshot().events[0];
    expect(event.network).toBe(event.expectedOriginal); expect(event.expectedOriginal).toBe(event.expectedWorkerTarget);
    expect(event.checks.networkIdEqualsOriginal && event.checks.originalEqualsWorkerTarget && event.checks.status200).toBe(true);
    expect(JSON.stringify(event)).not.toContain("bootstrap-original");
  });
  test("Fetch-before-attach remains rejected and exposes each unchanged guard result", async () => {
    const connection = new ProbeProtocolMock("fetch-before-attach"), facts = newFacts();
    await expect(startupProbe(connection, "http://fixture", connection.counts, { ...MOCK_TIMING, facts })).rejects.toThrow("probe-fetch-owner-mismatch");
    const events = facts.startupTrace.events, fetch = events.find(event => event.method === "Fetch.requestPaused");
    expect(fetch.checks).toMatchObject({ originalPresent: true, workerTargetPresent: false, sessionIsPage: true,
      networkIdEqualsOriginal: true, originalEqualsWorkerTarget: false, bootstrapUrlMatches: true, getMethod: true,
      firstPauseCandidate: true, status200: true, responseErrorAbsent: true, redirectedRequestAbsent: true,
      responseHeadersArray: true, responseHeadersWithinBound: true });
    expect(events.some(event => event.method === "Network.requestWillBeSent" && event.sequence < fetch.sequence)).toBe(true);
    expect(events.filter(event => event.method === "Target.attachedToTarget" && event.checks.targetIsWorker)).toHaveLength(0);
    expect(connection.commands.some(command => command.method === "Fetch.getResponseBody")).toBe(false);
  });
  for (const mode of ["foreign-parent", "missing-bootstrap", "wrong-bootstrap-body", "wrong-pause", "early-import", "detach", "late-worker", "missing-import", "missing-wasm", "missing-body"]) {
    test(`fixed frozen trace survives ${mode} rejection`, async () => {
      const connection = new ProbeProtocolMock(mode), facts = newFacts();
      await expect(startupProbe(connection, "http://fixture", connection.counts, { ...MOCK_TIMING, facts })).rejects.toThrow(/^owned-cdp:/);
      expect(facts.startupTrace.events.length).toBeGreaterThan(0); expect(facts.startupTrace.events.length).toBeLessThanOrEqual(32);
      expect(Object.isFrozen(facts.startupTrace)).toBe(true);
      const encoded = JSON.stringify(facts.startupTrace); connection.event("arbitrary secret event", { token: "private" });
      expect(JSON.stringify(facts.startupTrace)).toBe(encoded); expect(encoded).not.toMatch(/https:|token=secret|untrusted/);
      if (mode === "wrong-bootstrap-body") expect(facts.startupTrace.events.some(event => event.method === "probe.bootstrap-fetch" && event.phase === "reject")).toBe(true);
    });
  }
  test("root setup command rejection retains fixed method but not arbitrary error text", async () => {
    const connection = new ProbeProtocolMock(), facts = newFacts();
    connection.send = async () => { throw new Error("https://secret.invalid/?token=private body"); };
    await expect(startupProbe(connection, "http://fixture", {}, { ...MOCK_TIMING, facts })).rejects.toThrow();
    expect(facts.startupTrace.events.map(event => [event.method, event.phase])).toEqual([
      ["Target.createBrowserContext", "send"], ["Target.createBrowserContext", "reject"],
    ]);
    expect(JSON.stringify(facts.startupTrace)).not.toMatch(/secret|private|token|body|https/);
  });
});

test.describe("read-only launch prerequisite diagnostics", () => {
  const secret = "https://private.invalid/?token=secret /secret/path authorization=secret";
  for (const [text, category] of [
    ["Running as root without --no-sandbox is not supported", "root-refusal"],
    ["No usable sandbox!", "no-usable-sandbox"],
    ["Failed to move to new namespace: errno = Operation not permitted", "namespace-denied"],
    ["The SUID sandbox helper binary was found, but is not configured correctly", "helper-configuration"],
    ["an unrelated error", "unknown"],
  ]) {
    test(`returns only the fixed ${category} stderr category`, () => {
      expect(stderrCategory(`${secret} ${text} ${secret}`)).toBe(category);
      expect(stderrCategory("x".repeat(4096) + text)).toBe("unknown");
    });
  }
  for (const text of ["", "-1", "2", "1 token", "01", "1\nextra", "4294967296", secret, null]) {
    test(`malformed bounded setting ${JSON.stringify(text)}`, () => {
      expect(numericObservation(text, 1)).toEqual({ status: "invalid", value: null });
    });
  }
  test("accepts only bounded numeric settings without inventing missing values", () => {
    expect(numericObservation("0\n", 1)).toEqual({ status: "observed", value: 0 });
    expect(numericObservation("1", 1)).toEqual({ status: "observed", value: 1 });
    expect(numericObservation("4294967295")).toEqual({ status: "observed", value: 4294967295 });
  });
  test("collects fixed sibling metadata and never reads an override value", async () => {
    const names = [], env = {}; Object.defineProperty(env, "CHROME_DEVEL_SANDBOX", { get() { throw new Error("value must not be read"); } });
    const observations = await collectLaunchPrerequisites({ realpath: "/installed/chrome" }, {
      effectiveUid: () => 1001, overridePresent: () => Object.hasOwn(env, "CHROME_DEVEL_SANDBOX"),
      read: async name => name.endsWith("max_user_namespaces") ? "65536\n" : "1\n",
      lstat: async name => { names.push(name); return { uid: 0, gid: 0, mode: 0o104755, isFile: () => true, isSymbolicLink: () => false }; },
    });
    expect(names.sort()).toEqual(["/installed/chrome-sandbox", "/installed/chrome_sandbox"]);
    expect(observations.underscoreHelper).toEqual({ status: "observed", kind: "regular-file", uid: 0, gid: 0, mode: 0o4755 });
    expect(observations.chromeDevelSandboxPresent).toBe(true); expect(observations.chromeDevelSandboxInherited).toBe(false);
    expect(Object.isFrozen(observations) && Object.isFrozen(observations.effectiveUid) && Object.isFrozen(observations.underscoreHelper)).toBe(true);
    expect(JSON.stringify(observations)).not.toContain("/installed");
  });
  test("absent, unreadable and timed-out inputs stay unavailable without raw errors", async () => {
    const observations = await collectLaunchPrerequisites({ realpath: "/secret/chrome" }, {
      effectiveUid: () => { throw new Error(secret); }, overridePresent: () => { throw new Error(secret); },
      read: async () => { throw new Error(secret); }, lstat: () => new Promise(() => {}), timeoutMs: 5,
    });
    expect(observations.effectiveUid.status).toBe("unavailable"); expect(observations.unprivilegedUsernsClone.status).toBe("unavailable");
    expect(observations.chromeDevelSandboxPresent).toBe(null); expect(observations.underscoreHelper.status).toBe("unavailable");
    expect(JSON.stringify(observations)).not.toMatch(/secret|private|token|\/secret/);
  });
  test("missing fixed sibling helpers are distinguished from unreadable metadata", async () => {
    const observations = await collectLaunchPrerequisites({ realpath: "/installed/chrome" }, {
      effectiveUid: () => 1001, overridePresent: () => false, read: async () => "1",
      lstat: async () => { throw Object.assign(new Error(secret), { code: "ENOENT" }); },
    });
    expect(observations.hyphenHelper.status).toBe("absent");
    expect(observations.chromeDevelSandboxPresent).toBe(false);
    expect(JSON.stringify(observations)).not.toContain(secret);
  });
  test("malformed helper metadata and symlinks are never followed or called usable", () => {
    expect(helperObservation({ uid: "root", gid: 0, mode: 0o4755 }).status).toBe("invalid");
    expect(helperObservation({ uid: 1001, gid: 1001, mode: 0o120777, isFile: () => false, isSymbolicLink: () => true }).kind).toBe("symlink");
    expect(helperObservation(null).status).toBe("unavailable");
  });
  test("sanitized launch failure retains only frozen diagnostics", async () => {
    const observations = await collectLaunchPrerequisites(undefined, { effectiveUid: () => 0, overridePresent: () => false, read: async () => "0" });
    const error = attachPrerequisites(new Error(secret), observations, `No usable sandbox! ${secret}`, true);
    expect(error.message).toBe("owned-cdp:launch-failed"); expect(error.stack).not.toContain(secret);
    expect(prerequisiteDiagnosticsFor(error).stderrCategory).toBe("no-usable-sandbox");
    expect(prerequisiteDiagnosticsFor(error).stderrCaptureTruncated).toBe(true);
    expect(Object.isFrozen(prerequisiteDiagnosticsFor(error))).toBe(true);
    expect(prerequisiteDiagnosticsFor(new Error(secret))).toBe(null);
    expect(JSON.stringify(prerequisiteDiagnosticsFor(error))).not.toMatch(/secret|private|token/);
  });
});

test("owned flattened CDP real Chromium startup capability probe", async () => {
  test.setTimeout(40000);
  let owned, server; const counts = {}, facts = newFacts(); let prerequisites = null;
  try {
    owned = await launchOwnedChromium(); prerequisites = owned.prerequisites;
    server = http.createServer((request, response) => {
      const name = request.url; counts[name] = (counts[name] || 0) + 1;
      if (request.method !== "GET" || counts[name] > 1) { response.writeHead(409); response.end(); return; }
      let bytes = BODIES[name];
      if (name === "/") bytes = Buffer.from('<!doctype html><script>const w=new Worker("/bootstrap.js");w.onmessage=e=>{if(e.data==="owned-worker-done")console.log(e.data);};</script>');
      if (!bytes) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": name === "/worker.wasm" ? "application/wasm" : name === "/" ? "text/html" : "text/javascript",
        "Content-Length": bytes.length, "Cache-Control": "no-store" }); response.end(bytes);
    });
    await deadline(new Promise((resolve, reject) => { server.once("error", () => reject(problem("fixture-server-failed"))); server.listen(0, "127.0.0.1", resolve); }), 1000, "fixture-server-timeout");
    const origin = `http://127.0.0.1:${server.address().port}`;
    await startupProbe(owned.connection, origin, counts, { facts });
    await owned.verify(); facts.endpointReverified = true; facts.stage = "endpoint-reverified";
    expect(facts.capability).toBe("classic-bootstrap-second-gate-observed");
  } catch (error) {
    prerequisites ||= prerequisiteDiagnosticsFor(error);
    facts.errorCode = /^owned-cdp:[a-z-]+$/.test(error?.message || "") ? error.message : "owned-cdp:probe-failed";
    throw problem(facts.errorCode.slice(10));
  } finally {
    let failure;
    try { if (owned) { await owned.close(); facts.cleanupVerified = true; if (!facts.errorCode) facts.stage = "cleanup-verified"; } } catch (error) { failure = error; }
    if (server) {
      try { server.closeAllConnections(); await deadline(new Promise(resolve => server.close(resolve)), 1000, "fixture-server-cleanup-timeout"); }
      catch { failure ||= problem("fixture-server-cleanup-failed"); }
    }
    if (failure) facts.errorCode = /^owned-cdp:[a-z-]+$/.test(failure.message || "") ? failure.message : "owned-cdp:cleanup-failed";
    facts.probeSucceeded = facts.capability === "classic-bootstrap-second-gate-observed" && facts.endpointReverified && facts.cleanupVerified && !facts.errorCode;
    console.log(`OWNED_FLAT_CDP_PROBE ${JSON.stringify({ ...facts, prerequisites, browserVersion: owned?.pin.browserVersion || null, playwrightVersion: owned?.pin.playwrightVersion || null })}`);
    if (failure) throw problem(facts.errorCode.slice(10));
  }
});
