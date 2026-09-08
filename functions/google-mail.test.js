"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { sendEnquiryEmail } = require("./google-mail");
const options = { mailbox: "private-recipient@example.com", oauthJson: JSON.stringify({ clientId: "test-client", clientSecret: "test-client-secret", refreshToken: "test-refresh-token" }),
  enquiry: { requestId: "6bcdf0a1-7d59-4de3-9bc9-329a9dd99128", name: "Visitor", email: "visitor@example.com" }, text: "A test enquiry." };
test("refreshes OAuth token and sends MIME through the Gmail API", async () => {
  const requests = [];
  await sendEnquiryEmail(options, async (url, request) => {
    requests.push({ url, request });
    return { ok: true, json: async () => requests.length === 1 ? { access_token: "test-access-token" } : { id: "mail-id" } };
  });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://oauth2.googleapis.com/token");
  assert.equal(requests[0].request.body.get("grant_type"), "refresh_token");
  assert.equal(requests[1].url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(requests[1].request.headers.Authorization, "Bearer test-access-token");
  const mime = Buffer.from(JSON.parse(requests[1].request.body).raw, "base64url").toString();
  assert.match(mime, /To: private-recipient@example.com/);
  assert.match(mime, /Reply-To: Visitor <visitor@example.com>/);
  assert.match(mime, /A test enquiry/);
  assert.doesNotMatch(mime, /test-refresh-token|test-client-secret|test-access-token/);
});
test("invalid OAuth configuration is rejected without network calls", async () => {
  await assert.rejects(sendEnquiryEmail({ ...options, oauthJson: "invalid secret" }, () => assert.fail("No network call expected")), { code: "oauth-config" });
});
test("rejected refresh token does not send mail or reveal provider details", async () => {
  let count = 0;
  await assert.rejects(sendEnquiryEmail(options, async () => {
    count++; return { ok: false, json: async () => ({ error: "private provider response" }) };
  }), { code: "oauth-rejected", message: "Google email delivery could not complete." });
  assert.equal(count, 1);
});
test("Gmail API rejection is reported safely for retry", async () => {
  let count = 0;
  await assert.rejects(sendEnquiryEmail(options, async () => ++count === 1
    ? { ok: true, json: async () => ({ access_token: "private token" }) }
    : { ok: false }), { code: "gmail-rejected" });
});
test("network errors do not expose request headers or credentials", async () => {
  await assert.rejects(sendEnquiryEmail(options, async () => { throw new Error("private access token in network error"); }),
    { code: "mail-network", message: "Google email delivery could not complete." });
});
