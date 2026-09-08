"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const valid = { requestId: "6bcdf0a1-7d59-4de3-9bc9-329a9dd99128", name: "Test Visitor", email: "visitor@example.com", phone: "", message: "I would like help with a garment sample.", website: "" };
function harness() {
  const rows = new Map();
  const mail = [];
  let failEmail = false;
  const ref = (id) => ({ id, update: async (data) => rows.set(id, { ...rows.get(id), ...data }) });
  const db = {
    collection: (collection) => ({ doc: (id) => ref(`${collection}/${id}`) }),
    runTransaction: async (callback) => {
      const writes = [];
      const result = await callback({
        get: async (doc) => ({ exists: rows.has(doc.id), data: () => rows.get(doc.id) }),
        create: (doc, data) => writes.push(() => rows.set(doc.id, data)),
        set: (doc, data) => writes.push(() => rows.set(doc.id, data)),
        update: (doc, data) => writes.push(() => rows.set(doc.id, { ...rows.get(doc.id), ...data }))
      });
      writes.forEach((write) => write());
      return result;
    }
  };
  const stamp = (value) => ({ toMillis: () => value });
  const modules = {
    "firebase-admin/app": { initializeApp() {} },
    "firebase-admin/firestore": { getFirestore: () => db, Timestamp: { fromMillis: stamp },
      FieldValue: { serverTimestamp: () => stamp(Date.now()), increment: () => 1, delete: () => undefined } },
    "firebase-functions/v2/https": { onRequest: (options, handler) => handler },
    "firebase-functions/v2/firestore": { onDocumentCreated: (options, handler) => handler },
    "firebase-functions/params": { defineSecret: () => ({ value: () => "private-test-setting" }) },
    "firebase-functions/logger": { error() {} },
    "./google-mail": { sendEnquiryEmail: async ({ enquiry }) => {
      if (failEmail) throw new Error("Sensitive provider failure");
      mail.push({ replyTo: { address: enquiry.email } });
    } },
    "./contact": require("./contact"),
    "node:crypto": require("node:crypto")
  };
  const context = { exports: {}, require: (name) => modules[name] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "index.js"), "utf8"), context);
  const submit = async (body = valid, options = {}) => {
    const request = { body, method: "POST", ip: "192.0.2.1", is: () => true,
      get: () => "https://wearglasgow.co.uk", ...options };
    const response = { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
    await context.exports.submitEnquiry(request, response);
    return response;
  };
  const deliver = () => context.exports.emailEnquiry({ data: { ref: ref(`websiteEnquiries/${valid.requestId}`) }, params: { enquiryId: valid.requestId } });
  return { rows, mail, submit, deliver, failEmail: () => { failEmail = true; }, recoverEmail: () => { failEmail = false; } };
}
test("stores an enquiry and deduplicates a retry", async () => {
  const h = harness();
  assert.equal((await h.submit()).statusCode, 202);
  assert.equal((await h.submit()).statusCode, 202);
  assert.equal(h.rows.size, 3);
  assert.equal([...h.rows.entries()].find(([key]) => key.startsWith("websiteContactLimits/ip"))[1].count, 1);
});
test("same ID cannot be reused for changed content", async () => {
  const h = harness(); await h.submit();
  assert.equal((await h.submit({ ...valid, message: "An entirely different message" })).statusCode, 409);
});
test("rate limit rejects sixth enquiry without persisting it", async () => {
  const h = harness();
  for (let i = 0; i < 5; i++) assert.equal((await h.submit({ ...valid, requestId: `6bcdf0a1-7d59-4de3-9bc9-329a9dd9912${i}` })).statusCode, 202);
  assert.equal((await h.submit()).statusCode, 429);
});
test("rejects disallowed origins and non-POST requests", async () => {
  const h = harness();
  assert.equal((await h.submit(valid, { get: () => "https://untrusted.example" })).statusCode, 403);
  assert.equal((await h.submit(valid, { method: "GET" })).statusCode, 405);
  assert.equal(h.rows.size, 0);
});
test("response never contains private mail settings", async () => {
  const h = harness();
  assert.doesNotMatch(JSON.stringify((await h.submit()).body), /private-test-setting|@/);
});
test("successful notification is not resent on a repeated trigger", async () => {
  const h = harness(); await h.submit(); await h.deliver(); await h.deliver();
  assert.equal(h.mail.length, 1);
  assert.equal(h.mail[0].replyTo.address, valid.email);
  assert.equal(h.rows.get(`websiteEnquiries/${valid.requestId}`).deliveryStatus, "sent");
});
test("failed notification retains enquiry and can retry without leaking provider errors", async () => {
  const h = harness(); await h.submit(); h.failEmail();
  await assert.rejects(h.deliver(), { message: "Contact email delivery failed." });
  assert.equal(h.rows.get(`websiteEnquiries/${valid.requestId}`).deliveryStatus, "pending");
  h.recoverEmail(); await h.deliver(); assert.equal(h.mail.length, 1);
});
test("expired deliveries are marked failed without sending", async () => {
  const h = harness(); await h.submit();
  h.rows.get(`websiteEnquiries/${valid.requestId}`).createdAt = { toMillis: () => Date.now() - 90000000 };
  await h.deliver();
  assert.equal(h.rows.get(`websiteEnquiries/${valid.requestId}`).deliveryStatus, "failed");
  assert.equal(h.mail.length, 0);
});
