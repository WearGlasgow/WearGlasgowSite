"use strict";
(() => {
  const menuToggle = document.querySelector(".menu-toggle");
  const navigation = document.getElementById("site-navigation");
  if (menuToggle && navigation) {
    const closeMenu = () => {
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.querySelector(".menu-toggle-label").textContent = "Menu";
    };
    menuToggle.addEventListener("click", () => {
      const opening = menuToggle.getAttribute("aria-expanded") !== "true";
      menuToggle.setAttribute("aria-expanded", String(opening));
      menuToggle.querySelector(".menu-toggle-label").textContent = opening ? "Close" : "Menu";
    });
    navigation.addEventListener("click", (event) => {
      if (event.target.closest("a")) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
        closeMenu();
        menuToggle.focus();
      }
    });
  }

  const form = document.getElementById("contact-form");
  if (!form) return;
  const button = form.querySelector("button[type=submit]");
  const status = document.getElementById("contact-status");
  const config = window.WEAR_CONTACT;
  const fields = form.querySelector("fieldset");
  let busy = false;
  let requestId;
  let lastPayload;
  if (!config?.enabled || !config.endpoint || !window.crypto?.randomUUID) {
    status.textContent = "Online enquiries are temporarily unavailable. Please check back soon.";
    return;
  }
  fields.disabled = false;
  status.textContent = "";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !form.reportValidity()) return;
    const data = new FormData(form);
    const enquiry = Object.fromEntries(["name", "email", "phone", "message", "website"].map((key) => [key, String(data.get(key) || "").trim()]));
    const payload = JSON.stringify(enquiry);
    if (payload !== lastPayload) {
      requestId = crypto.randomUUID();
      lastPayload = payload;
    }
    busy = true;
    fields.disabled = true;
    button.textContent = "Sending...";
    form.setAttribute("aria-busy", "true");
    status.textContent = "Sending your enquiry...";
    status.dataset.state = "pending";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(config.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...enquiry, requestId }), signal: controller.signal,
        credentials: "omit", referrerPolicy: "no-referrer"
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error("We have received too many enquiries. Please try again later.");
        throw new Error("We could not confirm receipt of your enquiry. Your message is still here; please try again.");
      }
      status.textContent = "Thank you. Your enquiry has been received. We'll be in touch.";
      status.dataset.state = "success";
      form.reset();
      requestId = undefined;
      lastPayload = undefined;
    } catch (error) {
      status.textContent = error.name === "AbortError" || error instanceof TypeError
        ? "We could not confirm receipt of your enquiry. Please check your connection and try again."
        : error.message;
      status.dataset.state = "error";
    } finally {
      clearTimeout(timeout);
      busy = false;
      fields.disabled = false;
      button.textContent = "Send enquiry";
      form.removeAttribute("aria-busy");
    }
  });
})();
