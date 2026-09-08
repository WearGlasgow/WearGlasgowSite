"use strict";
const { createHash } = require("node:crypto");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { sendEnquiryEmail } = require("./google-mail");
const { ContactError, validateEnquiry, payloadHash, emailText } = require("./contact");
initializeApp();
const db = getFirestore();
const mailbox = defineSecret("CONTACT_MAILBOX");
const googleOAuth = defineSecret("CONTACT_GOOGLE_OAUTH");
const origins = ["https://wearglasgow.co.uk", "https://www.wearglasgow.co.uk",
  "https://wearglasgow.web.app", "https://wearglasgow.firebaseapp.com"];
// Match the existing nam5 Firestore database's recommended functions region.
const region = "us-central1";

exports.submitEnquiry = onRequest({ region, cors: origins, maxInstances: 2, timeoutSeconds: 30, invoker: "public" }, async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ message: "Please submit the contact form." });
  if (!origins.includes(req.get("origin"))) return res.status(403).json({ message: "Please submit your enquiry through our website." });
  if (!req.is("application/json")) return res.status(415).json({ message: "Please submit the contact form." });
  if (req.rawBody && req.rawBody.length > 24000) return res.status(413).json({ message: "Your enquiry is too long." });
  try {
    const enquiry = validateEnquiry(req.body);
    const hash = payloadHash(enquiry);
    const now = Date.now();
    const hour = Math.floor(now / 3600000);
    const day = Math.floor(now / 86400000);
    const ipHash = createHash("sha256").update(`${day}:${req.ip || "unknown"}`).digest("hex");
    const ref = db.collection("websiteEnquiries").doc(enquiry.requestId);
    const ipLimit = db.collection("websiteContactLimits").doc(`ip-${hour}-${ipHash}`);
    const dailyLimit = db.collection("websiteContactLimits").doc(`day-${day}`);
    await db.runTransaction(async (tx) => {
      const [existing, ipCount, dayCount] = await Promise.all([tx.get(ref), tx.get(ipLimit), tx.get(dailyLimit)]);
      if (existing.exists) {
        if (existing.data().payloadHash !== hash) throw new ContactError(409, "Please refresh the page and try again.");
        return;
      }
      if ((ipCount.data()?.count || 0) >= 5 || (dayCount.data()?.count || 0) >= 100) {
        throw new ContactError(429, "We have received too many enquiries. Please try again later.");
      }
      tx.create(ref, { ...enquiry, payloadHash: hash, createdAt: FieldValue.serverTimestamp(), deliveryStatus: "pending" });
      const expiresAt = Timestamp.fromMillis(now + 2 * 86400000);
      tx.set(ipLimit, { count: (ipCount.data()?.count || 0) + 1, expiresAt });
      tx.set(dailyLimit, { count: (dayCount.data()?.count || 0) + 1, expiresAt });
    });
    return res.status(202).json({ message: "Thank you. Your enquiry has been received." });
  } catch (error) {
    if (error instanceof ContactError) return res.status(error.status).json({ message: error.message });
    // Never log submitted personal information, mail settings, or provider responses.
    logger.error("Contact enquiry could not be saved.");
    return res.status(503).json({ message: "We could not receive your enquiry. Please try again shortly." });
  }
});

exports.emailEnquiry = onDocumentCreated({ region, document: "websiteEnquiries/{enquiryId}",
  secrets: [mailbox, googleOAuth], retry: true, maxInstances: 2, timeoutSeconds: 120 }, async (event) => {
  const ref = event.data?.ref;
  if (!ref) return;
  const enquiry = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.data();
    if (!current || ["sent", "failed"].includes(current.deliveryStatus)) return null;
    if (current.createdAt.toMillis() < Date.now() - 86400000) {
      tx.update(ref, { deliveryStatus: "failed" });
      return null;
    }
    if (current.deliveryStatus === "sending" && current.leaseUntil?.toMillis() > Date.now()) {
      throw new Error("Email delivery already in progress; retry later.");
    }
    tx.update(ref, { deliveryStatus: "sending", leaseUntil: Timestamp.fromMillis(Date.now() + 180000),
      deliveryAttempts: FieldValue.increment(1) });
    return current;
  });
  if (!enquiry) return;
  try {
    await sendEnquiryEmail({ mailbox: mailbox.value().trim(), oauthJson: googleOAuth.value(),
      enquiry, text: emailText(enquiry) });
    await ref.update({ deliveryStatus: "sent", sentAt: FieldValue.serverTimestamp(), leaseUntil: FieldValue.delete() });
  } catch {
    await ref.update({ deliveryStatus: "pending", leaseUntil: FieldValue.delete() });
    logger.error("Contact email delivery failed; a retry is scheduled.");
    throw new Error("Contact email delivery failed.");
  }
});
