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
  if (!process.env.SEND_API_KEY) throw new Error("Missing SEND_API_KEY");
}

function getSmtpSettings(input) {
  const custom = input && typeof input === "object";
  const source = custom ? input : process.env;
  return {
    custom,
    host: String(custom ? source.host : source.SMTP_HOST || "").trim(),
    port: Number(custom ? source.port : source.SMTP_PORT),
    secure: isTrue(custom ? source.secure : source.SMTP_SECURE),
    requireTLS: isTrue(custom ? source.requireTLS : source.SMTP_REQUIRE_TLS),
    user: String(custom ? source.user : source.SMTP_USER || "").trim(),
    pass: String(custom ? source.pass : source.SMTP_PASS || ""),
    fromEmail: String(custom ? source.fromEmail : source.FROM_EMAIL || "").trim(),
    replyTo: String(custom ? source.replyTo : source.REPLY_TO || "").trim(),
  };
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
  const fromName = String(
    req.body?.fromName !== undefined ? req.body.fromName : process.env.FROM_NAME || ""
  ).trim();
  const smtp = getSmtpSettings(req.body?.smtp);

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
  if (fromName.length > 100) {
    return res.status(400).json({ error: "From name must be 100 characters or fewer." });
  }
  if (
    !/^[a-z0-9.-]{1,253}$/i.test(smtp.host) ||
    !Number.isInteger(smtp.port) ||
    smtp.port < 1 ||
    smtp.port > 65535 ||
    !smtp.user ||
    !smtp.pass ||
    !EMAIL_PATTERN.test(smtp.fromEmail) ||
    (smtp.replyTo && !EMAIL_PATTERN.test(smtp.replyTo))
  ) {
    return res.status(smtp.custom ? 400 : 500).json({
      error: smtp.custom
        ? "Enter complete and valid custom SMTP settings."
        : "The saved SMTP configuration is incomplete or invalid.",
    });
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: smtp.requireTLS,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
    tls: {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
    },
  });

  const from = fromName
    ? { name: fromName, address: smtp.fromEmail }
    : smtp.fromEmail;
  const results = [];

  try {
    for (const recipient of recipients) {
      try {
        await transporter.sendMail({
          from,
          to: recipient,
          subject,
          replyTo: smtp.replyTo || smtp.fromEmail,
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
