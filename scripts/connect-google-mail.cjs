"use strict";
// Run locally. Authorization codes and tokens never enter website files or console output.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { spawn } = require("node:child_process");
const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";
function matchingState(actual, expected) {
  return typeof actual === "string" && /^[0-9a-f]{64}$/.test(actual) && actual.length === expected.length &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function clientFromFile(filename) {
  const client = JSON.parse(fs.readFileSync(filename, "utf8").replace(/^\uFEFF/, "")).installed;
  if (!client || client.project_id !== "wearglasgow" || !client.client_id || !client.client_secret) {
    throw new Error("Use a Desktop app OAuth client JSON downloaded from project wearglasgow.");
  }
  return client;
}
async function main() {
  let client;
  try { client = clientFromFile(process.argv[2]); }
  catch { throw new Error("Could not read a Desktop app OAuth client for wearglasgow. Check the downloaded JSON path and client type."); }
  const cliRoot = path.join(process.env.APPDATA, "npm/node_modules/firebase-tools/lib");
  require(path.join(cliRoot, "logger")).logger.silent = true;
  const account = require(path.join(cliRoot, "auth")).getProjectDefaultAccount(path.resolve(__dirname, ".."));
  try { await require(path.join(cliRoot, "requireAuth")).requireAuth({ project: "wearglasgow", ...account }); }
  catch { throw new Error("Sign in with firebase login first, then run this helper again."); }
  const { Client } = require(path.join(cliRoot, "apiv2"));
  const secrets = new Client({ urlPrefix: "https://secretmanager.googleapis.com", apiVersion: "v1" });
  let mailbox;
  try {
    const value = await secrets.get("/projects/wearglasgow/secrets/CONTACT_MAILBOX/versions/latest:access", { skipLog: { resBody: true } });
    mailbox = Buffer.from(value.body.payload.data, "base64").toString("utf8").trim();
  } catch { throw new Error("The private mailbox setting could not be read. Check Firebase access."); }
  const state = randomBytes(32).toString("hex");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let finish, fail;
  const authorization = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // Prevent a premature timeout rejection from becoming an unhandled rejection.
  authorization.catch(() => {});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (req.method !== "GET" || url.pathname !== "/oauth2callback") { res.writeHead(404).end("Not found"); return; }
    if (!matchingState(url.searchParams.get("state"), state)) { res.writeHead(400).end("Sign-in could not be verified."); return; }
    if (url.searchParams.has("error") || !url.searchParams.get("code")) {
      res.writeHead(400).end("Google sign-in was not completed. Return to PowerShell.");
      fail(new Error("Google sign-in was cancelled or denied. No credentials were saved.")); return;
    }
    res.end("Google sign-in received. Return to PowerShell to confirm the connection finishes.");
    finish(url.searchParams.get("code"));
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirect, response_type: "code",
    scope: `openid email ${GMAIL_SCOPE}`, access_type: "offline", prompt: "consent select_account",
    state, code_challenge: challenge, code_challenge_method: "S256" });
  const timeout = setTimeout(() => fail(new Error("Google sign-in timed out. Run the helper again.")), 10 * 60 * 1000);
  let code;
  try {
    console.log("Opening Google sign-in. Select the mailbox used for enquiries and approve email sending.");
    const command = `Start-Process '${url.toString().replace(/'/g, "''")}'`;
    await new Promise((resolve, reject) => {
      const process = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { windowsHide: true, stdio: "ignore" });
      process.once("error", () => reject(new Error("Could not open the browser.")));
      process.once("exit", status => status === 0 ? resolve() : reject(new Error("Could not open the browser.")));
    });
    code = await authorization;
  } finally {
    clearTimeout(timeout); server.close(); server.closeAllConnections();
  }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret,
      code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect }), signal: AbortSignal.timeout(20000) });
  if (!tokenResponse.ok) throw new Error("Google could not complete authorisation. Run the helper again.");
  const token = await tokenResponse.json();
  if (!token.refresh_token || !token.access_token || !token.scope?.split(" ").includes(GMAIL_SCOPE)) {
    throw new Error("Google did not grant ongoing email-sending access. Run the helper again and approve that permission.");
  }
  const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!identityResponse.ok) throw new Error("Could not verify the signed-in Google account. Nothing was saved.");
  const identity = await identityResponse.json();
  if (!identity.email_verified || identity.email?.toLowerCase() !== mailbox.toLowerCase()) {
    throw new Error("The Google account does not match the configured mailbox. Sign in to the enquiry mailbox and try again.");
  }
  const secretPath = "/projects/wearglasgow/secrets/CONTACT_GOOGLE_OAUTH";
  try { await secrets.get(secretPath, { skipLog: { resBody: true } }); }
  catch (error) {
    if (error.status !== 404 && error.context?.response?.statusCode !== 404) throw new Error("Could not check the private OAuth setting.");
    await secrets.post("/projects/wearglasgow/secrets", { replication: { automatic: {} } }, {
      queryParams: { secretId: "CONTACT_GOOGLE_OAUTH" }, skipLog: { body: true, resBody: true } });
  }
  const credentials = JSON.stringify({ clientId: client.client_id, clientSecret: client.client_secret, refreshToken: token.refresh_token });
  await secrets.post(`${secretPath}:addVersion`, { payload: { data: Buffer.from(credentials).toString("base64") } }, { skipLog: { body: true, resBody: true } });
  console.log("Google email connection saved privately in Firebase. No password was used.");
  console.log("The email function must now be redeployed and tested before the contact form is enabled.");
}
if (require.main === module) main().catch(error => {
  // Only show our own fixed messages, never Google/CLI responses containing private data.
  const safe = ["Use a Desktop", "Could not read a Desktop", "Sign in with firebase", "The private mailbox",
    "Google sign-in", "Could not open", "Google could not", "Google did not", "Could not verify",
    "The Google account", "Could not check"];
  console.error(safe.some(prefix => error.message?.startsWith(prefix)) ? error.message : "Google connection failed. Check your project access and OAuth setup, then try again. No credentials were printed.");
  process.exitCode = 1;
});
module.exports = { matchingState, clientFromFile };
