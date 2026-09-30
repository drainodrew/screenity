import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("../../src/pages/Background/drive/libraryQueue.js", import.meta.url), "utf8");
let storage = {};
let messages = [];
let reply = "queued";
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
const chrome = {
  storage: {local: {
    async get() { await pause(); return structuredClone(storage); },
    async set(value) { await pause(); storage = structuredClone(value); },
  }},
  identity: {async getAuthToken() {return {token: "test-ephemeral-token"};}},
  runtime: {async sendNativeMessage(host, message) {messages.push(message); return {status: reply};}},
};
const context = vm.createContext({chrome, console, Date, Object, Promise});
const script = source.replace(/^import .*;\n/, 'const libraryConfig = {enabled:true,nativeHost:"test",rootFolderId:"root123"};\n').replace(/export /g, "");
vm.runInContext(script, context);
await Promise.all(Array.from({length: 20}, (_, i) => context.enqueueLibraryRecording(`file${i}`, `Recording ${i}`)));
await pause();
assert.equal(Object.keys(storage.jevLibraryQueue).length, 20, "Concurrent arrivals must all survive");
assert.ok(!JSON.stringify(storage).includes("test-ephemeral-token"), "Access tokens must never persist in Chrome storage");
await context.drainLibraryQueue();
assert.equal(Object.keys(storage.jevLibraryQueue).length, 20, "Queued or processing replies must not remove unfinished recordings");
reply = "complete";
await Promise.all([context.drainLibraryQueue(), context.enqueueLibraryRecording("late", "Arrived during completion")]);
await pause();
assert.equal(storage.jevLibraryQueue.late?.fileId, "late", "A completion must not erase a concurrent arrival");
await context.drainLibraryQueue();
assert.equal(Object.keys(storage.jevLibraryQueue).length, 0, "Only completed receipts remove recordings");
assert.ok(messages.length > 0);
console.log("Queue checks passed: concurrent arrivals, completion races, retries, and ephemeral tokens.");
