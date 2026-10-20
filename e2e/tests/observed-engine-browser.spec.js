const { test, expect } = require("@playwright/test");
const { observedEngineFixture } = require("./observed-engine-fixture");
const { validateBuildResult } = require("../../app/public/build-result");

// Production Go WASM + native Chromium OPFS; only OCI responses are fixtures.
// The output contains fake kernel/initramfs/EFI bytes and cannot boot.
test("production WASM observed result uses real OPFS and rejects interrupted sinks", async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = observedEngineFixture();
  const unexpected = [];
  await page.route("https://**/*", async route => {
    const url = new URL(route.request().url());
    const body = url.hostname === "registry.invalid" && fixture.documents.get(url.pathname);
    if (!body) { unexpected.push(url.href); return route.abort(); }
    await route.fulfill({ body, contentType: "application/octet-stream", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route("**/engine-contract-fixture", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Non-bootable engine contract fixture</title>" }));
  await page.goto("/engine-contract-fixture");
  await page.addScriptTag({ url: "/wasm_exec.js" });
  const outcome = await page.evaluate(async () => {
    const go = new Go();
    const module = await WebAssembly.instantiateStreaming(fetch("/tbox.wasm"), go.importObject);
    const stopped = go.run(module.instance).then(() => { throw new Error("production WASM exited before the contract completed"); });
    // Register the race before any asynchronous OPFS/engine work.
    return await Promise.race([stopped, (async () => {
      if (typeof tboxBuildIsoWithResult !== "function") throw new Error("pinned engine lacks observed result API");
      const root = await navigator.storage.getDirectory();
      const opts = { label: "CONTRACT", initrd: new Uint8Array([116, 101, 115, 116]), request: {
        schemaVersion: 1, kind: "build-request", customImage: true,
        image: "fixture/boot:test", registry: "https://registry.invalid",
      } };
      const inspect = async () => JSON.parse(await tboxIntrospect("fixture/boot:test", "https://registry.invalid"));
      const failure = async promise => { try { await promise; return null; } catch (e) { return String(e); } };
      const facts = await inspect();
      const handle = await root.getFileHandle("non-bootable-contract.iso", { create: true });
      let writer = await handle.createWritable();
      let bytes = 0; let resetFailure; let overlapFailure; let checked = false;
      let result;
      try {
        result = await tboxBuildIsoWithResult(opts, async chunk => {
          if (!checked) {
            checked = true;
            resetFailure = await failure(tboxResetAsync());
            overlapFailure = await failure(tboxBuildIsoWithResult(opts, () => {}));
          }
          await writer.write(chunk); bytes += chunk.byteLength;
        });
        await writer.close();
        const saved = await handle.getFile();
        const magic = Array.from(new Uint8Array(await saved.slice(16 * 2048 + 1, 16 * 2048 + 6).arrayBuffer()));
        const interrupted = [];
        for (const cancel of [false, true]) {
          writer = await handle.createWritable();
          let settledResult = null;
          let abortCompleted = false;
          let postAbortWriteRejected = false;
          const error = await failure(tboxBuildIsoWithResult(opts, async chunk => {
            await writer.write(chunk);
            if (cancel) {
              await writer.abort();
              abortCompleted = true;
              try { await writer.write(chunk); }
              catch (error) { postAbortWriteRejected = true; throw error; }
              throw new Error("native OPFS unexpectedly accepted an aborted write");
            }
            throw new Error("fixture sink write failed");
          }).then(value => { settledResult = value; }));
          await writer.abort().catch(() => {});
          interrupted.push({ error, result: settledResult, abortCompleted, postAbortWriteRejected });
        }
        // A rejected sink must leave the engine recoverable with the same provenance.
        let recoveredBytes = 0;
        const recovered = await tboxBuildIsoWithResult(opts, chunk => { recoveredBytes += chunk.byteLength; });
        await tboxResetAsync();
        const filesAfterReset = [];
        for await (const name of root.keys()) filesAfterReset.push(name);
        const afterReset = await failure(tboxBuildIsoWithResult(opts, () => {}));
        return { facts, result, bytes, savedSize: saved.size, magic, resetFailure, overlapFailure,
          interrupted, recovered, recoveredBytes, afterReset, filesAfterReset };
      } finally {
        await writer.abort().catch(() => {});
        await tboxResetAsync();
        await root.removeEntry("non-bootable-contract.iso");
      }
    })()]);
  });
  expect(unexpected).toEqual([]);
  expect(outcome.bytes).toBeGreaterThan(0);
  expect(outcome.savedSize).toBe(outcome.bytes);
  expect(Buffer.from(outcome.magic).toString()).toBe("CD001");
  const result = validateBuildResult(outcome.result, outcome.bytes);
  expect(result.observedInputs.source).toMatchObject({ manifestDigest: fixture.manifestDigest, indexDigest: fixture.indexDigest,
    platformDescriptor: { architecture: "amd64" }, config: { descriptor: fixture.descriptor, bytesVerified: false } });
  expect(result.observedInputs.overlay).toEqual({ status: "custom-image", layersApplied: false, baseAnnotationMatched: false });
  expect(outcome.resetFailure).toContain("operation already in progress");
  expect(outcome.overlapFailure).toContain("operation already in progress");
  expect(outcome.interrupted[0]).toMatchObject({ error: expect.stringContaining("fixture sink write failed"), result: null });
  expect(outcome.interrupted[1]).toMatchObject({ result: null, abortCompleted: true, postAbortWriteRejected: true });
  expect(outcome.interrupted[1].error).toBeTruthy();
  expect(outcome.interrupted[1].error).not.toContain("unexpectedly accepted");
  expect(validateBuildResult(outcome.recovered, outcome.recoveredBytes).observedInputs).toEqual(result.observedInputs);
  expect(outcome.afterReset).toContain("introspect");
  expect(outcome.filesAfterReset).toEqual(["non-bootable-contract.iso"]);
});
