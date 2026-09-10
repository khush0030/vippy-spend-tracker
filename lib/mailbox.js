import { google } from "googleapis";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

/**
 * Reading a mailbox, without the caller knowing which kind it is.
 *
 * Both accounts are Gmail. Only the door differs: the Workspace one opens with
 * OAuth under an Internal consent screen, the personal one with an app
 * password over IMAP, because Google offers no single method that works for
 * both without an annual penetration test.
 *
 * Both transports fetch the raw RFC822 message and hand it to the same parser,
 * so the difference stops here and the harvester never sees it. Gmail's own
 * search syntax works over IMAP too, via X-GM-RAW, so even the query is shared.
 */

export const HARVEST_TERMS =
  "(invoice OR receipt OR booking OR ticket OR order OR confirmation OR payment OR bill OR reservation)";

function gmailQuery({ after, before, terms = HARVEST_TERMS }) {
  const d = (iso) => String(iso).slice(0, 10).replace(/-/g, "/");
  return `after:${d(after)} before:${d(before)} ${terms}`.trim();
}

function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Raw RFC822 bytes to the one shape the rest of the harvester understands. */
async function parseRaw(buffer, messageId) {
  const mail = await simpleParser(buffer);
  return {
    messageId,
    date: isoDate(mail.date) || null,
    from: mail.from?.text || "",
    subject: mail.subject || "",
    text: mail.text || "",
    html: mail.html || "",
    attachments: (mail.attachments || []).map((a) => ({
      filename: a.filename || "attachment",
      contentType: a.contentType || "application/octet-stream",
      size: a.size || a.content?.length || 0,
      content: a.content,
    })),
  };
}

function gmailAdapter(account) {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  auth.setCredentials({ refresh_token: account.credential });
  const gmail = google.gmail({ version: "v1", auth });

  return {
    async probe() {
      const { token } = await auth.getAccessToken();
      return Boolean(token);
    },

    async search(window) {
      const q = gmailQuery(window);
      const ids = [];
      let pageToken;
      do {
        const res = await gmail.users.messages.list({ userId: "me", q, maxResults: 500, pageToken });
        for (const m of res.data.messages || []) ids.push(m.id);
        pageToken = res.data.nextPageToken;
      } while (pageToken && ids.length < 2000);
      return ids;
    },

    async fetch(messageId) {
      const res = await gmail.users.messages.get({ userId: "me", id: messageId, format: "raw" });
      if (!res.data?.raw) return null;
      return parseRaw(Buffer.from(res.data.raw, "base64url"), messageId);
    },

    async close() {},
  };
}

function imapAdapter(account) {
  let client = null;
  let allMailPath = null;

  async function connected() {
    if (client?.usable) return client;
    client = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: account.email, pass: account.credential },
      logger: false,
    });
    await client.connect();
    return client;
  }

  async function allMail(c) {
    if (allMailPath) return allMailPath;
    // Gmail localises the folder's name but always flags it \All. Asking for
    // the flag works in every language; asking for the English name does not.
    const folders = await c.list();
    const flagged = folders.find((f) => f.specialUse === "\\All");
    allMailPath = flagged?.path || "[Gmail]/All Mail";
    return allMailPath;
  }

  return {
    async probe() {
      const c = await connected();
      await c.mailboxOpen("INBOX", { readOnly: true });
      return true;
    },

    async search(window) {
      const c = await connected();
      // "[Gmail]/All Mail" rather than INBOX: an invoice that was archived is
      // still an invoice, and Gmail archives aggressively.
      const lock = await c.getMailboxLock(await allMail(c), { readOnly: true });
      try {
        // X-GM-RAW takes Gmail's own search syntax, so the query is identical
        // to the one the API adapter sends.
        const uids = await c.search({ gmraw: gmailQuery(window) }, { uid: true });
        return (uids || []).map(String);
      } finally {
        lock.release();
      }
    },

    async fetch(messageId) {
      const c = await connected();
      const lock = await c.getMailboxLock(await allMail(c), { readOnly: true });
      try {
        const msg = await c.fetchOne(String(messageId), { source: true }, { uid: true });
        if (!msg?.source) return null;
        return parseRaw(msg.source, String(messageId));
      } finally {
        lock.release();
      }
    },

    async close() {
      if (client?.usable) await client.logout().catch(() => {});
      client = null;
      allMailPath = null;
    },
  };
}

export async function openMailbox(account) {
  if (!account?.credential) throw new Error(`Mailbox ${account?.email || "?"} has no credential`);
  return account.auth_kind === "imap_app_password" ? imapAdapter(account) : gmailAdapter(account);
}
