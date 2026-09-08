"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function setup(enabled = true) {
  const button = { textContent: "Send enquiry" };
  const fields = { disabled: true };
  const status = { textContent: "Unavailable", dataset: {} };
  const values = { name: "Test Visitor", email: "visitor@example.com", phone: "", message: "A project enquiry for the studio", website: "" };
  let handler, nextResult = { ok: true, status: 202 }, count = 0, reset = false;
  const requests = [];
  const form = { querySelector: (selector) => selector === "fieldset" ? fields : button,
    addEventListener: (_, callback) => { handler = callback; }, reportValidity: () => true,
    setAttribute() {}, removeAttribute() {}, reset: () => { reset = true; } };
  const crypto = { randomUUID: () => `request-${++count}` };
  const context = { window: { WEAR_CONTACT: { enabled, endpoint: "https://example.com/submit" }, crypto }, crypto,
    document: { getElementById: (id) => id === "contact-form" ? form : status },
    FormData: class { get(key) { return values[key]; } }, AbortController, setTimeout, clearTimeout,
    fetch: async (_, request) => { requests.push(JSON.parse(request.body)); return nextResult; } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../js/main.js"), "utf8"), context);
  return { fields, status, requests, values, wasReset: () => reset, fail: () => { nextResult = { ok: false, status: 503 }; },
    submit: () => handler({ preventDefault() {} }) };
}
test("unconfigured form stays disabled", () => {
  const h = setup(false); assert.equal(h.fields.disabled, true); assert.match(h.status.textContent, /temporarily unavailable/);
});
test("successful submission confirms receipt and resets the form", async () => {
  const h = setup(); await h.submit(); assert.equal(h.status.dataset.state, "success"); assert.equal(h.wasReset(), true);
  assert.equal(h.fields.disabled, false);
});
test("failure preserves the form and unchanged retries keep the same ID", async () => {
  const h = setup(); h.fail(); await h.submit(); await h.submit();
  assert.equal(h.wasReset(), false); assert.equal(h.requests[0].requestId, h.requests[1].requestId);
  assert.equal(h.status.dataset.state, "error"); assert.equal(h.fields.disabled, false);
});
test("edited enquiries get a new ID after a failed submission", async () => {
  const h = setup(); h.fail(); await h.submit(); h.values.message = "A different project enquiry"; await h.submit();
  assert.notEqual(h.requests[0].requestId, h.requests[1].requestId);
});
