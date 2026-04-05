import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a financial data extraction assistant. Parse bank transaction alert emails and Amazon order emails into structured transaction data.

For each email, extract:
- merchant: the merchant/vendor name
- amount: numeric amount in INR (just the number, no currency symbol)
- date: ISO date string (YYYY-MM-DD)
- category: one of: amazon, fuel, dining, swiggy, utilities, subscriptions, office, travel, other
- hasReceipt: true if it's an Amazon order (they include GST invoices), false otherwise
- itemDescription: for Amazon orders, extract the item name/description if available. For other transactions, leave as null.

Category rules:
- Amazon orders → "amazon"
- Petrol/diesel/fuel stations (HP, BPCL, Indian Oil, etc.) → "fuel"
- Restaurants, cafes, food courts → "dining"
- Swiggy, Zomato → "swiggy"
- Electricity, water, gas, phone bills → "utilities"
- Netflix, Spotify, YouTube, cloud services → "subscriptions"
- Office supplies, stationery, printing → "office"
- Airlines, hotels, trains, Uber, Ola, cabs → "travel"
- Everything else → "other"

Return ONLY a valid JSON array. Each object must have: merchant, amount, date, category, hasReceipt, itemDescription.
If an email doesn't contain a valid transaction, skip it.`;

async function parseBatch(emailBatch) {
  const emailSummaries = emailBatch
    .map(
      (e, i) =>
        `--- Email ${i + 1} (id: ${e.id}) ---\nFrom: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nBody:\n${e.body}\n`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: `${SYSTEM_PROMPT}\n\nEmails:\n${emailSummaries}`,
      },
    ],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.map((t, i) => ({
      id: emailBatch[i]?.id || `txn-${Date.now()}-${i}`,
      merchant: t.merchant || "Unknown",
      amount: parseFloat(t.amount) || 0,
      date: t.date || new Date().toISOString().split("T")[0],
      category: t.category || "other",
      hasReceipt: Boolean(t.hasReceipt),
      itemDescription: t.itemDescription || null,
      rawEmail:
        emailBatch.find((e) =>
          e.subject?.toLowerCase().includes(t.merchant?.toLowerCase().slice(0, 5))
        )?.subject ||
        emailBatch[i]?.subject ||
        "",
    }));
  } catch (err) {
    console.error("Failed to parse Claude response:", err.message);
    return [];
  }
}

export async function parseEmailsToTransactions(emails) {
  if (!emails.length) return [];

  // Process in batches of 20 emails to stay within token limits
  const BATCH_SIZE = 20;
  const allTransactions = [];

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    console.log(`Parsing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(emails.length / BATCH_SIZE)} (${batch.length} emails)...`);
    const transactions = await parseBatch(batch);
    allTransactions.push(...transactions);
  }

  return allTransactions;
}
