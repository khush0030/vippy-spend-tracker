import { google } from "googleapis";

function getOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/api/auth/callback`
  );
  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

function decodeBody(payload) {
  // Try to get text/plain part first, then text/html
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64url").toString("utf-8");
      }
    }
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64url").toString("utf-8");
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      if (part.parts) {
        const result = decodeBody(part);
        if (result) return result;
      }
    }
  }
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf-8");
  }
  return "";
}

export async function fetchHDFCEmails() {
  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  // Search for HDFC transaction alerts and Amazon order confirmations — full inbox
  // Broadened queries to catch various HDFC email formats
  const queries = [
    `from:alerts@hdfcbank.net`,
    `from:noreply@hdfcbank.net subject:transaction`,
    `from:auto-confirm@amazon.in`,
    `from:ship-confirm@amazon.in`,
    `from:order-update@amazon.in`,
  ];

  const allEmails = [];

  for (const q of queries) {
    try {
      // Paginate through all results
      let pageToken = undefined;
      const messages = [];
      do {
        const listRes = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: 500,
          pageToken,
        });
        messages.push(...(listRes.data.messages || []));
        pageToken = listRes.data.nextPageToken;
      } while (pageToken);

      for (const msg of messages) {
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: msg.id,
          format: "full",
        });

        const headers = detail.data.payload.headers;
        const subject =
          headers.find((h) => h.name.toLowerCase() === "subject")?.value || "";
        const from =
          headers.find((h) => h.name.toLowerCase() === "from")?.value || "";
        const date =
          headers.find((h) => h.name.toLowerCase() === "date")?.value || "";
        const body = decodeBody(detail.data.payload);

        allEmails.push({
          id: msg.id,
          subject,
          from,
          date,
          body: body.substring(0, 3000), // Limit body size for Claude
        });
      }
    } catch (err) {
      console.error(`Gmail query failed: ${q}`, err.message);
    }
  }

  return allEmails;
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
}

export async function getTokensFromCode(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}
