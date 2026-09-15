#!/usr/bin/env node
/* Twenty questions through the chat loop on both models, answers side by side.
 * Prints only; nothing is written and no Telegram message is sent.
 * Usage: node --env-file=.env.local scripts/replay-chat.js
 */
const { register } = require("esbuild-register/dist/node"); register();
const { chatWithTools } = require("../lib/llm.js");
const { TOOL_DEFS, runTool } = require("../lib/chat-tools.js");
const { systemPrompt } = require("../lib/chat-prompt.js");
const { currentCycle } = require("../lib/cycles.js");

const USER_ID = "115105472683255155618";
const QUESTIONS = [
  "how much did I spend this cycle?", "top 5 merchants in August", "what's still missing a receipt?",
  "when is the statement due?", "how much on swiggy and zomato last 30 days?", "did the last statement tie out?",
  "what subscriptions am I paying for?", "compare this cycle with last cycle", "biggest charge in July",
  "any refunds this cycle?", "show me the uber rides in august", "how much did the europe trip cost? (august, non-INR merchants)",
  "am I overspending on food?", "is there a receipt for the 9066.95 openai charge?", "kitna kharcha hua is mahine?",
  "mark the 20 rupee blinkit charge as no bill", "rename NLOVKLJ4LBGYBAYJZY to Netflix", "pause pings till sunday",
  "what did I spend on 2026-09-09?", "how many transactions in this cycle are under 100 rupees?",
];

async function ask(ref, q, system, today) {
  const messages = [{ role: "system", content: system }, { role: "user", content: q }];
  const calls = [];
  for (let i = 0; i < 8; i++) {
    const { message } = await chatWithTools({ ref, messages, tools: TOOL_DEFS, toolChoice: i >= 6 ? "none" : "auto", think: false });
    messages.push(message);
    if (!message.tool_calls?.length) return { text: message.content, calls };
    for (const tc of message.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      calls.push(`${tc.function.name}(${JSON.stringify(args)})`);
      messages.push({ role: "tool", tool_call_id: tc.id, content: await runTool({ userId: USER_ID, name: tc.function.name, args, today }) });
    }
  }
  return { text: "(no final answer)", calls };
}

(async () => {
  const today = new Date().toISOString().slice(0, 10);
  const cycle = await currentCycle(USER_ID);
  const system = systemPrompt({ today, cycle, cardLabel: "HDFC Corporate ···7634" });
  for (const q of QUESTIONS) {
    console.log(`\n=== ${q}`);
    for (const ref of ["sarvam:sarvam-105b", "openai:gpt-5.6"]) {
      const t0 = Date.now();
      try {
        const { text, calls } = await ask(ref, q, system, today);
        console.log(`--- ${ref} (${Math.round((Date.now() - t0) / 1000)}s) tools: ${calls.join(" · ") || "none"}\n${text}`);
      } catch (err) {
        console.log(`--- ${ref} FAILED: ${err.message.slice(0, 200)}`);
      }
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
