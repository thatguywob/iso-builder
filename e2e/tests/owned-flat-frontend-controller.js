// Owns only a test operation in the fresh context of an already owned launcher.
// Public Target/Page/Runtime census is independent of the Network byte ledger.
// No output from this proposal is admitted by production JS/Python consumers.
const { createOwnedFrontendState } = require("./owned-flat-frontend-state");
const { BodyReservations } = require("./owned-flat-body-reservations");
const { deadline } = require("./owned-flat-cdp");
const bad = code => new Error(`owned-controller:${code}`);
const id = value => typeof value === "string" && value.length > 0 && value.length <= 256;
const NETWORK = new Set(["Network.requestWillBeSent", "Network.requestServedFromCache", "Network.responseReceived", "Network.loadingFinished", "Network.loadingFailed"]);
async function openOwnedFrontendController(owned, { documentURL, workerURLs, expectedPageScripts = [], firstResumeDelayMs = 0, timeoutMs = 10000 } = {}) {
  if (!owned?.connection || !(owned.connection.bodyReservations instanceof BodyReservations) ||
      typeof owned.verify !== "function" || typeof owned.close !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw bad("configuration-invalid");
  const c = owned.connection, origin = new URL(documentURL).origin;
  if (!Array.isArray(expectedPageScripts) || expectedPageScripts.length > 64 || new Set(expectedPageScripts).size !== expectedPageScripts.length ||
      expectedPageScripts.some(url => typeof url !== "string" || new URL(url).origin !== origin || url === documentURL)) throw bad("page-script-policy-invalid");
  const pageScripts = new Map(), evaluations = new Map(); let initialFrame, navigationIssued = false;
  const initialContexts = new Set();
  let rejectLoaded;
  let context, page, pageTarget, frame, navigationFrame, runtimeContext, state, failure, stopped = false, closing = false, cleanup, pageLoaded = false;
  let eventCount = 0, documentRequests = 0; const frames = new Set(), attachedWorkers = new Map(), discovered = new Map();
  const fail = code => { failure ||= bad(code); state?.abort(); rejectLoaded?.(failure); return failure; };
  const check = () => { if (failure) throw failure; if (c.failure || c.socket?.failure) throw fail("transport-failed"); if (stopped) throw bad("closed"); };
  const send = (method, params = {}, session) => { check(); return c.send(method, params, session); };
  let resolveLoaded; const loaded = new Promise((resolve,reject) => { resolveLoaded = resolve; rejectLoaded = reject; }); loaded.catch(() => {});
  const maybeLoaded = () => { if (pageLoaded && frame && runtimeContext) resolveLoaded(); };
  const onEvent = packet => {
    if (stopped || failure || (closing && c.closed)) return;
    try {
      const { method, params: p, sessionId: session } = packet;
      // Stream data progress is not retained or treated as executable evidence.
      // The tiny diagnostic cap applies only to retained/control/lifecycle events.
      if (method === "Network.dataReceived") return;
      if (++eventCount > 8192) throw bad("event-bound");
      if (["Target.targetDestroyed", "Target.targetCrashed", "Target.detachedFromTarget", "Inspector.detached"].includes(method)) throw bad("target-lifecycle-lost");
      if (method === "Target.targetCreated" || method === "Target.targetInfoChanged") {
        const info = p.targetInfo;
        if (!id(info?.targetId) || !["page", "worker"].includes(info.type) || discovered.size >= 8 && !discovered.has(info.targetId)) throw bad("unsupported-target-census");
        if (method === "Target.targetCreated" && discovered.has(info.targetId)) throw bad("duplicate-target-census");
        discovered.set(info.targetId, { type: info.type, context: info.browserContextId, parent: info.parentId, url: info.url }); return;
      }
      if (method === "Target.attachedToTarget") {
        if (session === undefined && !page && p.targetInfo?.type === "page" && p.targetInfo.browserContextId === context &&
            p.waitingForDebugger === true && p.targetInfo.url === "about:blank" && id(p.sessionId) && id(p.targetInfo.targetId)) {
          page = p.sessionId; pageTarget = p.targetInfo.targetId; return;
        }
        if (!state || session !== page || p.targetInfo?.type !== "worker" || p.targetInfo.parentId !== pageTarget ||
            !id(p.targetInfo.targetId) || !id(p.sessionId) || attachedWorkers.has(p.targetInfo.targetId) ||
            [...attachedWorkers.values()].includes(p.sessionId) || attachedWorkers.size >= workerURLs.length) throw bad("worker-census-mismatch");
        attachedWorkers.set(p.targetInfo.targetId, p.sessionId); state.accept(packet); return;
      }
      if (method === "Page.frameAttached" || method === "Page.frameDetached" || method === "Page.navigatedWithinDocument" || method === "Page.windowOpen") throw bad("unsupported-page-lifecycle");
      if (method === "Page.frameNavigated") {
        if (!navigationIssued && session === page && p.frame?.id === initialFrame && p.frame.url === "about:blank" && !p.frame.parentId) return;
        if (session !== page || frame || p.frame?.parentId || !id(p.frame?.id) || p.frame.url !== documentURL || p.frame.unreachableUrl) throw bad("frame-census-mismatch");
        frame = p.frame.id; maybeLoaded(); return;
      }
      if (method === "Runtime.executionContextCreated" && session === page) {
        const value = p.context;
        if (value?.auxData?.isDefault !== true) throw bad("unsupported-execution-context");
        if (value.origin === origin) {
          if (runtimeContext || !Number.isSafeInteger(value.id) || value.id < 1 || !id(value.auxData.frameId)) throw bad("execution-context-mismatch");
          runtimeContext = { id: value.id, frame: value.auxData.frameId }; maybeLoaded();
        } else if (!runtimeContext && !frame && value.auxData.frameId === initialFrame && ["", "://"].includes(value.origin) &&
            Number.isSafeInteger(value.id) && value.id > 0 && initialContexts.size === 0) initialContexts.add(value.id);
        else throw bad("unsupported-execution-context");
      }
      if (method === "Runtime.executionContextDestroyed" && session === page) initialContexts.delete(p.executionContextId);
      if (method === "Runtime.executionContextsCleared" && session === page) initialContexts.clear();
      if (method === "Debugger.scriptParsed" && session === page) {
        if (!id(p.scriptId) || pageScripts.has(p.scriptId) || pageScripts.size >= 68 || p.scriptLanguage && p.scriptLanguage !== "JavaScript" ||
            (!expectedPageScripts.includes(p.url) && !evaluations.has(p.url))) throw bad("unsupported-page-script");
        pageScripts.set(p.scriptId, { id:p.scriptId, url:p.url, context:p.executionContextId }); return;
      }
      if (method === "Runtime.executionContextDestroyed" && p.executionContextId === runtimeContext?.id && session === page) throw bad("execution-context-lost");
      if (method === "Runtime.executionContextsCleared" && runtimeContext && session === page) throw bad("execution-context-lost");
      if (method === "Page.loadEventFired") { if (session === page && (!navigationIssued || !frame)) return; if (session !== page || pageLoaded) throw bad("page-load-mismatch"); pageLoaded = true; maybeLoaded(); return; }
      if (method === "Network.requestWillBeSent" && p.type === "Document") {
        if (session !== page || ++documentRequests !== 1 || !id(p.frameId) || p.request?.url !== documentURL) throw bad("document-census-mismatch");
        frames.add(p.frameId);
      }
      if (NETWORK.has(method) || method === "Fetch.requestPaused" || method.startsWith("Debugger.") || method === "Runtime.consoleAPICalled") {
        if (!state) throw bad("capture-started-too-late"); state.accept(packet);
      }
    } catch (error) { fail(/^owned-controller:[a-z-]+$/.test(error?.message || "") ? error.message.slice(17) : "event-invalid"); }
  };
  const onFailure = () => { if (!(closing && c.failure?.message === "owned-cdp:transport-disposed")) fail("transport-failed"); };
  c.on("event", onEvent); c.on("failure", onFailure);
  const close = () => cleanup ||= (async () => {
    closing = true;
    try {
      await owned.close(); state?.assertNoFailure();
      if (failure || !c.closed || (c.failure && c.failure.message !== "owned-cdp:transport-disposed") || c.socket?.failure) throw bad("late-observation-failed");
    } catch { throw fail("owned-cleanup-failed"); }
    finally { stopped = true; c.off("event", onEvent); c.off("failure", onFailure); state?.dispose(); }
  })();
  try {
    await owned.verify();
    const initial = await send("Target.getTargets");
    if (!Array.isArray(initial.targetInfos) || initial.targetInfos.length) throw bad("context-not-isolated");
    await send("Target.setDiscoverTargets", { discover: true });
    context = (await send("Target.createBrowserContext", { disposeOnDetach: true })).browserContextId;
    if (!id(context)) throw bad("context-missing");
    await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: "page" }, { exclude: true }] });
    const created = await send("Target.createTarget", { url: "about:blank", browserContextId: context });
    if (!page || created.targetId !== pageTarget) throw bad("page-attachment-missing");
    const blank = (await send("Page.getFrameTree", {}, page)).frameTree;
    if (!id(blank?.frame?.id) || blank.frame.url !== "about:blank" || blank.childFrames?.length) throw bad("initial-frame-mismatch");
    initialFrame = blank.frame.id;
    state = createOwnedFrontendState({ connection: c, pageSessionId: page, pageTargetId: pageTarget, documentURL, workerURLs,
      firstResumeDelayMs, timeoutMs, onFailure: () => fail("byte-observation-failed") });
    await Promise.all([
      send("Network.enable", { maxTotalBufferSize: c.bodyReservations.limits.maxTotalBytes, maxResourceBufferSize: c.bodyReservations.limits.maxResponseBytes }, page),
      send("Network.setCacheDisabled", { cacheDisabled: true }, page), send("Network.setBypassServiceWorker", { bypass: true }, page),
      send("Page.enable", {}, page), send("Runtime.enable", {}, page), send("Debugger.enable", {}, page),
      ...(workerURLs.length ? [send("Fetch.enable", { patterns: workerURLs.map(urlPattern => ({ urlPattern, requestStage: "Response" })) }, page)] : []),
      send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
        filter: [{ type: "worker" }, { type: "shared_worker" }, { type: "service_worker" }, { exclude: true }] }, page),
    ]);
    await send("Runtime.runIfWaitingForDebugger", {}, page);
    navigationIssued = true;
    const navigation = await send("Page.navigate", { url: documentURL }, page);
    if (navigation.errorText || !id(navigation.frameId)) throw bad("navigation-failed"); navigationFrame = navigation.frameId;
    await deadline(loaded, timeoutMs, "owned-page-load-timeout"); check();
    if (frame !== navigationFrame || runtimeContext.frame !== frame || documentRequests !== 1 || frames.size !== 1 || !frames.has(frame)) throw bad("document-census-mismatch");
    return Object.freeze({
      async evaluate(expression) {
        check(); if (typeof expression !== "string" || /[#@]\s*sourceURL\s*=/.test(expression) || Buffer.byteLength(expression) > 65000 || evaluations.size >= 4) throw fail("expression-bound");
        const label = `owned-controller-eval://operation/${evaluations.size + 1}`;
        expression += `\n//# sourceURL=${label}`;
        const token = c.bodyReservations.reserve(`controller-${evaluations.size + 1}`, Buffer.byteLength(expression));
        evaluations.set(label, { expression, token });
        const result = await send("Runtime.evaluate", { expression, contextId: runtimeContext.id, awaitPromise: true, returnByValue: true }, page); check();
        if (result.exceptionDetails || !result.result || !Object.hasOwn(result.result, "value")) throw fail("operation-evaluation-failed");
        return result.result.value;
      },
      async finish() {
        try {
          check();
          const tree = (await send("Page.getFrameTree", {}, page)).frameTree;
          if (tree?.frame?.id !== frame || tree.frame.url !== documentURL || tree.frame.securityOrigin !== origin || tree.childFrames?.length) throw fail("final-frame-census-mismatch");
          const targets = (await send("Target.getTargets")).targetInfos;
          if (!Array.isArray(targets) || targets.length !== 1 + attachedWorkers.size || discovered.size !== targets.length ||
              attachedWorkers.size !== workerURLs.length || new Set(targets.map(target => target.targetId)).size !== targets.length) throw fail("final-target-census-mismatch");
          for (const target of targets) {
            const observed = discovered.get(target.targetId);
            if (!observed || target.browserContextId !== context || observed.type !== target.type) throw fail("final-target-census-mismatch");
            if (target.targetId === pageTarget) {
              if (target.type !== "page" || target.url !== documentURL) throw fail("final-target-census-mismatch");
            } else if (target.type !== "worker" || !attachedWorkers.has(target.targetId) || target.parentId !== pageTarget || !workerURLs.includes(target.url)) throw fail("final-target-census-mismatch");
          }
          const bytes = await state.drainSnapshot(); check();
          if (initialContexts.size || [...pageScripts.values()].some(script => script.context !== runtimeContext.id)) throw fail("page-script-context-mismatch");
          const external = [...pageScripts.values()].filter(script => !evaluations.has(script.url));
          if (external.length !== expectedPageScripts.length || new Set(external.map(script=>script.url)).size !== external.length) throw fail("page-script-census-mismatch");
          await state.verifyPageScripts(external); check();
          for (const [label, expected] of evaluations) {
            const observed = [...pageScripts.values()].filter(script => script.url === label);
            if (observed.length !== 1) throw fail("controller-script-census-mismatch");
            c.bodyReservations.bind(expected.token,"source",page,observed[0].id);
            const source = await c.readBody(expected.token,"source"); check();
            if (source.scriptSource !== expected.expression) throw fail("controller-source-mismatch");
          }
          await owned.verify(); check();
          await close(); state.assertNoFailure();
          if (failure || c.socket?.failure || (c.failure && c.failure.message !== "owned-cdp:transport-disposed")) throw fail("late-observation-failed");
          return Object.freeze({ ...bytes, freshContextCreated: true, mainFrameCount: 1, terminalCleanupVerified: true,
            observedBrowserVersion: owned.pin.browserVersion, externallyServedPageScripts: external.length, controllerExpressions: evaluations.size });
        } catch (error) {
          fail(/^owned-controller:[a-z-]+$/.test(error?.message || "") ? error.message.slice(17) : "finish-failed");
          await close(); throw failure;
        }
      },
      dispose: close,
    });
  } catch {
    fail("setup-failed"); await close(); throw failure;
  }
}
module.exports = { openOwnedFrontendController };
