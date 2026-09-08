"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { matchingState } = require("./connect-google-mail.cjs");
const state = "a".repeat(64);
test("OAuth callback accepts matching state", () => assert.equal(matchingState(state, state), true));
test("OAuth callback rejects missing, mismatched and multibyte states", () => {
  for (const input of [null, "", "b".repeat(64), "a".repeat(63), "é".repeat(64)]) {
    assert.equal(matchingState(input, state), false);
  }
});
