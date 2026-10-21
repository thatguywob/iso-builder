// Test-only owned Chromium transport. No producer/qualification authority.
// Public CDP only; the real fixture must run in CI, never bypass a denied launch.
const fs = require("node:fs/promises");
const constants = require("node:fs").constants;
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { BodyReservations, METHODS: BODY_METHODS } = require("./owned-flat-body-reservations");
const { SOCKET_LIMITS } = require("./owned-flat-websocket");

const LIMITS = Object.freeze({ commandMs: 3000, launchMs: 10000, frameBytes: 256 * 1024, pending: 32 });
function problem(code) { return new Error(`owned-cdp:${code}`); }
async function deadline(promise, ms, code) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(problem(code)), ms);
  })]); } finally { clearTimeout(timer); }
}
async function readSmall(name, limit, noFollow = false) {
  const file = await fs.open(name, constants.O_RDONLY | (noFollow ? constants.O_NOFOLLOW | constants.O_NONBLOCK : 0));
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > limit) throw problem("metadata-file-invalid");
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size <= limit) {
      const read = await file.read(bytes, size, limit + 1 - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > limit) throw problem("metadata-file-oversize");
    const after = await file.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw problem("metadata-file-changed");
    }
    return { text: bytes.subarray(0, size).toString("utf8"), stat: after };
  } finally { await file.close(); }
}
function parseActivePort(text) {
  const match = /^([1-9][0-9]{0,4})\n(\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\n?$/i.exec(text);
  if (!match || Number(match[1]) > 65535) throw problem("endpoint-file-invalid");
  return { port: Number(match[1]), url: `ws://127.0.0.1:${match[1]}${match[2]}` };
}
function processIdentity(text, pid) {
  const end = text.lastIndexOf(") ");
  if (!text.startsWith(`${pid} (`) || end < 0) throw problem("process-stat-invalid");
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 20 || !/^[1-9][0-9]*$/.test(fields[19]) || fields[2] !== String(pid) || fields[3] !== String(pid)) {
    throw problem("process-group-invalid");
  }
  return { pid, start: fields[19], group: Number(fields[2]) };
}
function inspectEndpointRecords({ port, tcp, tcp6, sockets }) {
  const owned = new Set(sockets);
  const rows = [];
  for (const [family, text] of [[4, tcp], [6, tcp6]]) {
    for (const line of text.trim().split("\n").slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10) throw problem("socket-table-invalid");
      const [address, hexPort] = fields[1].split(":");
      if (!/^[0-9A-F]+$/i.test(address || "") || !/^[0-9A-F]{4}$/i.test(hexPort || "")) throw problem("socket-table-invalid");
      if (Number.parseInt(hexPort, 16) !== port || fields[3] !== "0A") continue;
      if (family !== 4 || address !== "0100007F") throw problem("endpoint-not-unique-ipv4-loopback");
      if (!owned.has(fields[9])) throw problem("endpoint-not-owned-by-process");
      rows.push({ family, inode: fields[9] });
    }
  }
  if (rows.length !== 1) throw problem("endpoint-listener-ambiguous");
  return rows[0].inode;
}
async function processSnapshot(pid, executable) {
  const identity = processIdentity((await readSmall(`/proc/${pid}/stat`, 8192)).text, pid);
  const actualExe = await fs.readlink(`/proc/${pid}/exe`);
  if (actualExe !== executable.realpath) throw problem("process-executable-mismatch");
  const stat = await fs.stat(`/proc/${pid}/exe`);
  if (stat.dev !== executable.dev || stat.ino !== executable.ino || stat.size !== executable.size) throw problem("process-executable-mismatch");
  return identity;
}
async function verifyEndpoint(profile, child, expected, executable) {
  if (child.exitCode !== null || child.signalCode !== null) throw problem("browser-exited");
  const first = await processSnapshot(child.pid, executable);
  if (first.start !== expected.start) throw problem("process-replaced");
  const active = await readSmall(path.join(profile, "DevToolsActivePort"), 512, true);
  if (active.stat.uid !== process.getuid()) throw problem("endpoint-owner-mismatch");
  const endpoint = parseActivePort(active.text);
  const fdRoot = `/proc/${child.pid}/fd`;
  const names = await fs.readdir(fdRoot);
  if (names.length > 1024) throw problem("process-fd-bound");
  const sockets = [];
  for (const name of names) {
    let value;
    try { value = await fs.readlink(`${fdRoot}/${name}`); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    const match = /^socket:\[([0-9]+)\]$/.exec(value); if (match) sockets.push(match[1]);
  }
  endpoint.inode = inspectEndpointRecords({ ...endpoint, sockets,
    tcp: (await readSmall(`/proc/${child.pid}/net/tcp`, 1024 * 1024)).text,
    tcp6: (await readSmall(`/proc/${child.pid}/net/tcp6`, 1024 * 1024)).text });
  const second = await processSnapshot(child.pid, executable);
  if (second.start !== expected.start || (await readSmall(path.join(profile, "DevToolsActivePort"), 512, true)).text !== active.text) {
    throw problem("endpoint-association-changed");
  }
  return endpoint;
}
function launchArguments(profile) {
  // Keep Chromium's sandbox intact. A runner sandbox failure is a failed test.
  return ["--headless=new", "--no-startup-window", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", `--user-data-dir=${profile}`];
}
async function readLaunchPin() {
  const { chromium } = require("@playwright/test");
  const packageRoot = path.dirname(require.resolve("playwright-core/package.json"));
  const pkg = JSON.parse((await readSmall(path.join(packageRoot, "package.json"), 65536)).text);
  const lock = JSON.parse((await readSmall(path.join(__dirname, "..", "package-lock.json"), 256 * 1024)).text);
  const version = lock.packages?.["node_modules/playwright-core"]?.version;
  if (pkg.version !== version || version !== "1.64.1") throw problem("playwright-pin-mismatch");
  const browsers = JSON.parse((await readSmall(path.join(packageRoot, "browsers.json"), 65536)).text);
  const entry = browsers.browsers.find(item => item.name === "chromium");
  if (entry?.revision !== "1248" || entry.browserVersion !== "156.0.8078.4") throw problem("chromium-pin-mismatch");
  const filename = chromium.executablePath();
  const realpath = await fs.realpath(filename); const stat = await fs.stat(realpath);
  if (!stat.isFile() || !(stat.mode & 0o111)) throw problem("chromium-executable-invalid");
  return { playwrightVersion: version, browserVersion: entry.browserVersion,
    executable: { filename, realpath, dev: stat.dev, ino: stat.ino, size: stat.size } };
}

class FlatConnection extends EventEmitter {
  constructor(socket, { commandMs = LIMITS.commandMs, bodyReservations = null } = {}) {
    super();
    if (!Number.isFinite(commandMs) || commandMs < 1 || commandMs > LIMITS.commandMs) throw problem("command-deadline-invalid");
    if (bodyReservations !== null && !(bodyReservations instanceof BodyReservations)) throw problem("body-profile-invalid");
    this.bodyReservations = bodyReservations;
    this.socket = socket; this.commandMs = commandMs; this.nextId = 0; this.pending = new Map();
    this.failure = null; this.closed = false;
    socket.addEventListener("message", event => this.receive(event.data));
    socket.addEventListener("close", () => this.fail("transport-closed"));
    socket.addEventListener("error", () => this.fail("transport-error"));
  }
  fail(code) {
    if (this.failure || this.closed) return;
    this.failure = problem(code); this.bodyReservations?.abort();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear(); this.emit("failure", this.failure);
  }
  receive(data) {
    if (this.failure || this.closed) return;
    // Default native WebSocket has already buffered the message. The explicit
    // body profile additionally needs the reviewed ws reassembly boundary; this
    // check alone is only an acceptance cap, never a process memory bound.
    const bytes = typeof data === "string" ? Buffer.byteLength(data) : Infinity;
    const cap = this.bodyReservations ? SOCKET_LIMITS.messageBytes : LIMITS.frameBytes;
    if (bytes > cap) { this.fail("frame-bound"); return; }
    let packet; try { packet = JSON.parse(data); } catch { this.fail("frame-json-invalid"); return; }
    if (!packet || typeof packet !== "object" || Array.isArray(packet)) { this.fail("frame-shape-invalid"); return; }
    if (Object.hasOwn(packet, "id")) {
      const pending = this.pending.get(packet.id);
      if (!pending || packet.sessionId !== pending.sessionId) { this.fail("reply-ownership-mismatch"); return; }
      if (bytes > LIMITS.frameBytes && !pending.capture) { this.fail("unreserved-large-reply"); return; }
      if (pending.capture && !packet.error) {
        try {
          if (Object.keys(packet).some(key => !["id", "sessionId", "result"].includes(key))) throw problem("body-reply-invalid");
          this.bodyReservations.validate(pending.capture.token, pending.capture.kind, packet.result);
        } catch { this.fail("body-reply-invalid"); return; }
      }
      this.pending.delete(packet.id); clearTimeout(pending.timer);
      if (packet.error) { pending.reject(problem("command-rejected")); this.fail("command-rejected"); }
      else if (!packet.result || typeof packet.result !== "object" || Array.isArray(packet.result)) { pending.reject(problem("reply-shape-invalid")); this.fail("reply-shape-invalid"); }
      else pending.resolve(packet.result);
    } else if (bytes > LIMITS.frameBytes) this.fail("unreserved-large-event");
    else if (typeof packet.method === "string" && packet.params && typeof packet.params === "object" && !Array.isArray(packet.params)) {
      this.emit("event", { method: packet.method, params: packet.params, sessionId: packet.sessionId });
    } else this.fail("event-shape-invalid");
  }
  send(method, params = {}, sessionId) {
    if (this.bodyReservations && Object.values(BODY_METHODS).includes(method)) return Promise.reject(problem("body-reservation-required"));
    return this.#dispatch(method, params, sessionId);
  }
  readBody(token, kind = "network") {
    if (!this.bodyReservations) return Promise.reject(problem("body-profile-required"));
    return this.bodyReservations.read(token, kind, binding => this.#dispatch(binding.method,
      kind === "source" ? { scriptId: binding.requestId } : { requestId: binding.requestId }, binding.sessionId, { token, kind }));
  }
  #dispatch(method, params, sessionId, capture = null) {
    if (this.failure || this.closed) return Promise.reject(this.failure || problem("transport-closed"));
    if (this.pending.size >= LIMITS.pending) { this.fail("pending-bound"); return Promise.reject(this.failure); }
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail("command-timeout"), this.commandMs);
      this.pending.set(id, { sessionId, method, capture, resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch { this.fail("command-send-failed"); }
    });
  }
  close() {
    if (this.closed) return;
    this.fail("transport-disposed"); this.closed = true;
    try { this.socket.close(); } catch { /* Owned process cleanup still follows. */ }
  }
}

// Separate, mockable teardown. A sent signal is never counted as an exit.
async function cleanupOwnedProcess({ child, identity, executable, exited, endpoint }, io) {
  if (!child?.pid) return;
  const alive = () => child.exitCode === null && child.signalCode === null;
  const signal = async name => {
    if (!alive()) return;
    if (identity) {
      const current = await io.snapshot(child.pid, executable).catch(() => null);
      if (!alive()) return;
      if (!current || current.start !== identity.start) throw problem("cleanup-process-ownership-lost");
      io.groupSignal(-child.pid, name);
    } else {
      // Retained direct ChildProcess only. Never signal an unverified group.
      child.kill(name);
    }
  };
  if (alive()) {
    await signal("SIGTERM");
    try { await io.wait(exited, 1500, "cleanup-term-timeout"); }
    catch {
      await signal("SIGKILL");
      await io.wait(exited, 1500, "cleanup-kill-timeout");
    }
  }
  if (alive()) throw problem("cleanup-exit-unobserved");
  if (!identity) throw problem("cleanup-preidentity-unverified");
  if (endpoint && await io.listenerPresent(endpoint.inode)) throw problem("cleanup-listener-survived");
  const until = Date.now() + 1000;
  while (io.groupPresent(child.pid)) {
    if (Date.now() >= until) throw problem("cleanup-process-group-survived");
    await io.pause(25);
  }
}
async function listenerPresent(inode) {
  for (const name of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = (await readSmall(name, 1024 * 1024)).text;
    if (text.trim().split("\n").slice(1).some(line => {
      const fields = line.trim().split(/\s+/); return fields[3] === "0A" && fields[9] === inode;
    })) return true;
  }
  return false;
}
// Diagnostic observations only: these patterns are not a definitive host-cause
// diagnosis. Never return stderr, paths, environment values, or raw exceptions.
const diagnosticErrors = new WeakMap();
function prerequisiteDiagnosticsFor(error) { return diagnosticErrors.get(error) || null; }
function stderrCategory(text) {
  const bounded = typeof text === "string" ? text.slice(0, 4096) : "";
  if (/Running as root without --no-sandbox is not supported/i.test(bounded)) return "root-refusal";
  if (/SUID sandbox helper binary was found, but is not configured correctly|setuid sandbox[^\n]{0,160}not configured correctly/i.test(bounded)) return "helper-configuration";
  if (/(?:Failed to move to new namespace|unshare|CLONE_NEWUSER|user namespace)[^\n]{0,256}(?:Operation not permitted|Permission denied|EPERM|EACCES)/i.test(bounded)) return "namespace-denied";
  if (/No usable sandbox!/i.test(bounded)) return "no-usable-sandbox";
  return "unknown";
}
function numericObservation(text, maximum = 0xffffffff) {
  if (typeof text !== "string" || !/^(?:0|[1-9][0-9]{0,9})\n?$/.test(text)) return Object.freeze({ status: "invalid", value: null });
  const value = Number(text.trim());
  return Object.freeze(value <= maximum ? { status: "observed", value } : { status: "invalid", value: null });
}
function unavailableNumber() { return Object.freeze({ status: "unavailable", value: null }); }
function helperObservation(stat) {
  const empty = { status: "unavailable", kind: null, uid: null, gid: null, mode: null };
  if (!stat) return Object.freeze(empty);
  if (![stat.uid, stat.gid, stat.mode].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff)) return Object.freeze({ ...empty, status: "invalid" });
  if (typeof stat.isSymbolicLink !== "function" || typeof stat.isFile !== "function") return Object.freeze({ ...empty, status: "invalid" });
  const kind = stat.isSymbolicLink() ? "symlink" : stat.isFile() ? "regular-file" : "other";
  return Object.freeze({ status: "observed", kind, uid: stat.uid, gid: stat.gid, mode: stat.mode & 0o7777 });
}
async function collectLaunchPrerequisites(executable, io = {}) {
  const read = io.read || (async name => (await readSmall(name, 32, true)).text);
  const lstat = io.lstat || (name => fs.lstat(name));
  const uid = io.effectiveUid || (() => process.geteuid());
  const overridePresent = io.overridePresent || (() => Object.hasOwn(process.env, "CHROME_DEVEL_SANDBOX"));
  const timeout = io.timeoutMs === undefined ? 250 : io.timeoutMs;
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > 250) throw problem("diagnostic-deadline-invalid");
  const number = async (name, maximum) => {
    try { return numericObservation(await deadline(read(name), timeout, "diagnostic-read-timeout"), maximum); }
    catch { return unavailableNumber(); }
  };
  const helper = async basename => {
    if (!executable?.realpath) return helperObservation(null);
    try { return helperObservation(await deadline(lstat(path.join(path.dirname(executable.realpath), basename)), timeout, "diagnostic-stat-timeout")); }
    catch (error) { return error?.code === "ENOENT" ? Object.freeze({ ...helperObservation(null), status: "absent" }) : helperObservation(null); }
  };
  let effectiveUid = unavailableNumber(), sandboxOverridePresent = null;
  try { const value = uid(); effectiveUid = Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff ? numericObservation(String(value)) : Object.freeze({ status: "invalid", value: null }); } catch { /* unavailable */ }
  try { const present = overridePresent(); if (typeof present === "boolean") sandboxOverridePresent = present; } catch { /* unavailable */ }
  const [unprivilegedUsernsClone, maxUserNamespaces, apparmorRestrictUnprivilegedUserns,
    apparmorRestrictUnprivilegedUnconfined, underscoreHelper, hyphenHelper] = await Promise.all([
    number("/proc/sys/kernel/unprivileged_userns_clone", 1), number("/proc/sys/user/max_user_namespaces", 0xffffffff),
    number("/proc/sys/kernel/apparmor_restrict_unprivileged_userns", 1), number("/proc/sys/kernel/apparmor_restrict_unprivileged_unconfined", 1),
    // Only the hyphen spelling is Chromium 156's adjacent helper candidate.
    // Neither metadata result proves a helper is selected or usable.
    helper("chrome_sandbox"), helper("chrome-sandbox"),
  ]);
  return Object.freeze({ basis: "read-only-prerequisites-and-bounded-stderr", stderrCategory: "unknown", stderrCaptureTruncated: false,
    effectiveUid, unprivilegedUsernsClone, maxUserNamespaces, apparmorRestrictUnprivilegedUserns, apparmorRestrictUnprivilegedUnconfined,
    chromeDevelSandboxPresent: sandboxOverridePresent, chromeDevelSandboxInherited: false,
    underscoreHelper, hyphenHelper });
}
function attachPrerequisites(error, observations, stderr, truncated) {
  const safe = safeError(error, "launch-failed");
  diagnosticErrors.set(safe, Object.freeze({ ...observations, stderrCategory: stderrCategory(stderr), stderrCaptureTruncated: truncated === true }));
  return safe;
}

async function launchOwnedChromium() {
  let pin, profile, child, identity, connection, socket, endpoint, exited, stderr = "", stderrTruncated = false, prerequisites, stopping = false, cleanupPromise;
  const cleanup = () => cleanupPromise ||= (async () => {
    stopping = true;
    connection?.close();
    try { socket?.close(); } catch { /* Process teardown still follows. */ }
    try {
      await cleanupOwnedProcess({ child, identity, executable: pin?.executable, exited, endpoint }, {
        snapshot: (pid, executable) => deadline(processSnapshot(pid, executable), 1000, "cleanup-identity-timeout"),
        groupSignal: (pid, name) => process.kill(pid, name), wait: deadline,
        listenerPresent: inode => deadline(listenerPresent(inode), 1000, "cleanup-listener-timeout"),
        pause: ms => new Promise(resolve => setTimeout(resolve, ms)),
        groupPresent: pid => { try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === "ESRCH") return false; throw problem("cleanup-group-unverified"); } },
      });
      if (profile) await deadline(fs.rm(profile, { recursive: true, force: true }), 1500, "cleanup-profile-timeout");
    } catch (error) { throw safeError(error, "cleanup-failed"); }
  })();
  try {
    if (process.platform !== "linux" || typeof globalThis.WebSocket !== "function") throw problem("unsupported-host");
    pin = await readLaunchPin();
    prerequisites = await collectLaunchPrerequisites(pin.executable);
    profile = await fs.mkdtemp(path.join(os.tmpdir(), "iso-owned-cdp-"));
    const env = Object.fromEntries(["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "XDG_RUNTIME_DIR"]
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    child = spawn(pin.executable.realpath, launchArguments(profile), { env, detached: true, stdio: ["ignore", "ignore", "pipe"] });
    exited = new Promise(resolve => child.once("exit", () => { connection?.fail("browser-exited"); resolve(); }));
    child.on("error", () => connection?.fail("browser-process-error"));
    child.stderr.on("data", bytes => {
      const part = bytes.subarray(0, 4097).toString("utf8");
      if (bytes.length > 4097 || stderr.length + part.length > 4096) stderrTruncated = true;
      stderr = (stderr + part).slice(0, 4096);
    });
    await deadline(new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", () => reject(problem("browser-spawn-failed"))); }), 3000, "browser-spawn-timeout");
    identity = await deadline(processSnapshot(child.pid, pin.executable), 1000, "process-identity-timeout");
    await deadline((async () => {
      while (!endpoint && !stopping) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw problem(/sandbox|Running as root/i.test(stderr) ? "browser-sandbox-unavailable" : "browser-exited-before-endpoint");
        }
        try {
          const candidate = await verifyEndpoint(profile, child, identity, pin.executable);
          if (stopping) throw problem("launch-stopped");
          endpoint = candidate;
        }
        catch (error) {
          if (stopping) throw problem("launch-stopped");
          if (error.code !== "ENOENT") throw problem("endpoint-verification-failed");
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      if (stopping) throw problem("launch-stopped");
    })(), LIMITS.launchMs, "endpoint-timeout");
    socket = new WebSocket(endpoint.url);
    await deadline(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(problem("websocket-connect-failed")), { once: true });
    }), 3000, "websocket-connect-timeout");
    const verify = async () => {
      const current = await deadline(verifyEndpoint(profile, child, identity, pin.executable), 1500, "endpoint-recheck-timeout");
      if (socket.url !== endpoint.url || current.url !== endpoint.url || current.inode !== endpoint.inode) throw problem("endpoint-association-changed");
    };
    await verify();
    connection = new FlatConnection(socket);
    const version = await connection.send("Browser.getVersion");
    if (version.product !== `Chrome/${pin.browserVersion}` && version.product !== `HeadlessChrome/${pin.browserVersion}`) {
      throw problem("observed-browser-pin-mismatch");
    }
    return { connection, pin, prerequisites, verify: async () => { try { await verify(); } catch (error) { throw safeError(error, "endpoint-recheck-failed"); } }, close: cleanup };
  } catch (error) {
    prerequisites ||= await collectLaunchPrerequisites(pin?.executable);
    try { await cleanup(); } catch (cleanupError) { throw attachPrerequisites(cleanupError, prerequisites, stderr, stderrTruncated); }
    throw attachPrerequisites(error, prerequisites, stderr, stderrTruncated);
  }
}
function safeError(error, fallback) {
  return /^owned-cdp:[a-z-]+$/.test(error?.message || "") ? problem(error.message.slice(10)) : problem(fallback);
}
module.exports = { FlatConnection, launchOwnedChromium, parseActivePort, processIdentity, inspectEndpointRecords,
  launchArguments, readLaunchPin, deadline, problem, LIMITS, cleanupOwnedProcess, readSmall, stderrCategory, numericObservation, helperObservation,
  collectLaunchPrerequisites, prerequisiteDiagnosticsFor, attachPrerequisites };
