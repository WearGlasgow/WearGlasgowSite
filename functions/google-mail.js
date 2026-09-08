"use strict";
const nodemailer = require("nodemailer");
function privateError(code) {
  const error = new Error("Google email delivery could not complete.");
  error.code = code;
  return error;
}
async function sendEnquiryEmail({ mailbox, oauthJson, enquiry, text }, fetchImpl = fetch) {
  let oauth;
  try { oauth = JSON.parse(oauthJson); } catch { throw privateError("oauth-config"); }
  if (![oauth.clientId, oauth.clientSecret, oauth.refreshToken].every(v => typeof v === "string" && v.length)) {
    throw privateError("oauth-config");
  }
  try {
    const tokenResponse = await fetchImpl("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: oauth.clientId, client_secret: oauth.clientSecret,
        refresh_token: oauth.refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000)
    });
    if (!tokenResponse.ok) throw privateError("oauth-rejected");
    const token = await tokenResponse.json();
    if (typeof token.access_token !== "string" || !token.access_token) throw privateError("oauth-rejected");
    // Nodemailer only builds MIME locally. SMTP and app passwords are not used.
    const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
    const message = await composer.sendMail({ from: { name: "Wear Glasgow website", address: mailbox },
      to: mailbox, replyTo: { name: enquiry.name, address: enquiry.email },
      subject: "New Wear Glasgow website enquiry", text,
      messageId: `<website-enquiry-${enquiry.requestId}@wearglasgow.co.uk>`,
      disableFileAccess: true, disableUrlAccess: true });
    const response = await fetchImpl("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: message.message.toString("base64url") }), signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw privateError("gmail-rejected");
    const result = await response.json();
    if (!result.id) throw privateError("gmail-rejected");
  } catch (error) {
    if (["oauth-config", "oauth-rejected", "gmail-rejected"].includes(error.code)) throw error;
    throw privateError("mail-network");
  }
}
module.exports = { sendEnquiryEmail };
