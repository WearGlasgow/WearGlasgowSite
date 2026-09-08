"use strict";
const { createHash } = require("node:crypto");

class ContactError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function validateEnquiry(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new ContactError(400, "Please check your enquiry and try again.");
  }
  const field = (key, min, max, multiline = false) => {
    if (typeof data[key] !== "string") throw new ContactError(400, "Please check your enquiry and try again.");
    const value = data[key].trim();
    if (value.length < min || value.length > max || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value)) {
      throw new ContactError(400, "Please check your enquiry and try again.");
    }
    return value;
  };
  const requestId = field("requestId", 36, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new ContactError(400, "Please refresh the page and try again.");
  }
  const name = field("name", 1, 100);
  const email = field("email", 3, 254);
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new ContactError(400, "Please enter a valid email address.");
  const phone = field("phone", 0, 40);
  const message = field("message", 10, 5000, true);
  const website = field("website", 0, 200);
  if (website) throw new ContactError(400, "Your enquiry could not be submitted.");
  return { requestId, name, email, phone, message };
}
function payloadHash(enquiry) {
  return createHash("sha256").update(JSON.stringify(enquiry)).digest("hex");
}
function emailText(enquiry) {
  return ["New website enquiry", "", `Name: ${enquiry.name}`, `Email: ${enquiry.email}`,
    `Phone: ${enquiry.phone || "Not provided"}`, "", enquiry.message].join("\n");
}
module.exports = { ContactError, validateEnquiry, payloadHash, emailText };
