"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEnquiry, payloadHash, emailText } = require("./contact");
const valid = { requestId: "6bcdf0a1-7d59-4de3-9bc9-329a9dd99128", name: "Test Visitor", email: "visitor@example.com", phone: "", message: "I would like help with a garment sample.", website: "" };
test("accepts and trims a valid enquiry including optional phone", () => {
  assert.equal(validateEnquiry({ ...valid, name: "  Test Visitor " }).name, "Test Visitor");
  assert.equal(validateEnquiry(valid).phone, "");
});
for (const [name, change] of [
  ["email header injection", { email: "visitor@example.com\r\nBcc: other@example.com" }],
  ["name header injection", { name: "Visitor\nBcc: other@example.com" }],
  ["missing email", { email: "" }],
  ["invalid email", { email: "no-at-sign" }],
  ["oversized message", { message: "a".repeat(5001) }],
  ["short message", { message: "hello" }],
  ["honeypot", { website: "spam" }],
  ["invalid request ID", { requestId: "../../sensitive" }],
  ["non-string name", { name: { injected: true } }],
]) test(`rejects ${name}`, () => assert.throws(() => validateEnquiry({ ...valid, ...change }), { status: 400 }));
test("message can contain multiple lines and is sent as plain text", () => {
  const enquiry = validateEnquiry({ ...valid, message: "First line\n<script>plain text</script>" });
  assert.ok(emailText(enquiry).includes(enquiry.message));
});
test("payload hash distinguishes changes and stays stable for retries", () => {
  assert.equal(payloadHash(valid), payloadHash({ ...valid }));
  assert.notEqual(payloadHash(valid), payloadHash({ ...valid, message: "Changed message" }));
});
