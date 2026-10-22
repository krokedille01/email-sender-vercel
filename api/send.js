"use strict";

const crypto = require("crypto");
const nodemailer = require("nodemailer");

const MAX_RECIPIENTS = 20;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 100000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isTrue(value) {
  return /^(true|1|yes|on)$/i.test(String(value || ""));
}

function keysMatch(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(String(received));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function parseRecipients(value) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[\n,;]+/);
  return [...new Set(input.map((item) => String(item).trim().toLowerCase()).filter(Boolean))];
}

function requireEnvironment() {
  const names = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASS",
    "FROM_EMAIL",
    "SEND_API_KEY",
  ];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing server configuration: ${missing.join(", ")}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    requireEnvironment();
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ error: "The server is not configured." });
  }

  if (!keysMatch(req.headers["x-api-key"], process.env.SEND_API_KEY)) {
    return res.status(401).json({ error: "Invalid access key." });
  }

  const recipients = parseRecipients(req.body?.recipients);
  const subject = String(req.body?.subject || "").trim();
  const body = String(req.body?.body || "");
  const format = req.body?.format === "text" ? "text" : "html";

  if (!recipients.length || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
    return res.status(400).json({ error: "Enter valid recipient email addresses." });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return res.status(400).json({ error: `A maximum of ${MAX_RECIPIENTS} recipients is allowed.` });
  }
  if (!subject || subject.length > MAX_SUBJECT_LENGTH) {
    return res.status(400).json({ error: `Subject must be 1-${MAX_SUBJECT_LENGTH} characters.` });
  }
  if (!body.trim() || body.length > MAX_BODY_LENGTH) {
    return res.status(400).json({ error: `Message must be 1-${MAX_BODY_LENGTH} characters.` });
  }

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(500).json({ error: "The SMTP port is invalid." });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: isTrue(process.env.SMTP_SECURE),
    requireTLS: isTrue(process.env.SMTP_REQUIRE_TLS),
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });

  const from = process.env.FROM_NAME
    ? { name: process.env.FROM_NAME, address: process.env.FROM_EMAIL }
    : process.env.FROM_EMAIL;
  const results = [];

  try {
    for (const recipient of recipients) {
      try {
        await transporter.sendMail({
          from,
          to: recipient,
          subject,
          replyTo: process.env.REPLY_TO || process.env.FROM_EMAIL,
          [format]: body,
        });
        results.push({ email: recipient, sent: true });
      } catch (error) {
        console.error(`Send failed for ${recipient}:`, error.message);
        results.push({ email: recipient, sent: false });
      }
    }
  } finally {
    transporter.close();
  }

  const sent = results.filter((result) => result.sent).length;
  return res.status(sent === recipients.length ? 200 : 502).json({
    sent,
    failed: recipients.length - sent,
    results,
  });
};
