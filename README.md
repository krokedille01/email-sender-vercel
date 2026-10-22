# Vercel email sender

This is a separate web version of the email sender. SMTP credentials are read
only by the server-side function and are never included in the HTML.

## Run locally

1. Copy `.env.example` to `.env.local`.
2. Fill in `SMTP_PASS` and choose a long, random `SEND_API_KEY`.
3. Run `npm install`.
4. Run `npm run dev`.
5. Open the local URL printed by Vercel and enter the same `SEND_API_KEY`.

## Deploy

Import this folder as a new Vercel project, then add every variable from
`.env.example` under **Project Settings → Environment Variables**. Redeploy
after saving the variables.

The web form requires `SEND_API_KEY` before the API will send. Do not put the
SMTP password in `public/index.html`, commit an `.env` file, or share the access
key publicly.

## Changing sender settings

The form uses the SMTP variables saved in Vercel by default. The **From name**
can be changed for every send.

To use another account temporarily, clear **Use SMTP settings saved in
Vercel**, then enter its host, port, username, password, From email, and TLS
options. Custom credentials are sent to the protected server function over
HTTPS for that request and are not saved by the page.

## SMTP security

The requested server `smtp.sinbfir.org.br:587` authenticates successfully but
does not advertise STARTTLS. Its connection is therefore unencrypted. If
available, prefer UOL Host's encrypted endpoint:

```text
SMTP_HOST=smtps.uhserver.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=false
```
