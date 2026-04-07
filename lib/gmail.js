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

export async function fetchHDFCEmails(sinceDate = null) {
  const auth = getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  // Build date filter for incremental sync
  const dateFilter = sinceDate
    ? ` after:${new Date(sinceDate).toISOString().split("T")[0].replace(/-/g, "/")}`
    : "";

  // Consolidated queries (3 instead of 14) using Gmail OR operator
  const queries = [
    // HDFC Bank — all transaction alerts
    `(from:alerts@hdfcbank.net OR from:noreply@hdfcbank.net OR (from:hdfcbank.net (subject:transaction OR subject:refund OR subject:reversal OR subject:credit)))${dateFilter}`,
    // Amazon — orders, returns, refunds
    `(from:auto-confirm@amazon.in OR from:ship-confirm@amazon.in OR from:order-update@amazon.in OR from:returns@amazon.in OR (from:amazon.in (subject:refund OR subject:return OR subject:"Your order")))${dateFilter}`,
    // Food delivery — Swiggy & Zomato
    `((from:noreply@swiggy.in subject:order) OR (from:noreply@zomato.com subject:order))${dateFilter}`,
  ];

  // Collect unique message IDs across all queries
  const seenIds = new Set();
  const uniqueMessages = [];

  for (const q of queries) {
    try {
      let pageToken = undefined;
      do {
        const listRes = await gmail.users.messages.list({
          userId: "me",
          q,
          maxResults: 500,
          pageToken,
        });
        for (const msg of listRes.data.messages || []) {
          if (!seenIds.has(msg.id)) {
            seenIds.add(msg.id);
            uniqueMessages.push(msg);
          }
        }
        pageToken = listRes.data.nextPageToken;
      } while (pageToken);
    } catch (err) {
      console.error(`Gmail query failed: ${q}`, err.message);
    }
  }

  // Fetch full details for each unique message
  const allEmails = [];
  for (const msg of uniqueMessages) {
    try {
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
        body: body.substring(0, 3000),
      });
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err.message);
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
