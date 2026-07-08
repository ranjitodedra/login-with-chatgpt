import { randomUUID } from "node:crypto";

import { getUserInfoFromToken } from "./auth.js";

const CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex/responses";

function model() {
  return process.env.CODEX_MODEL ?? "gpt-5.5";
}

function mockMode() {
  return process.env.MOCK_MODE === "1";
}

function debug() {
  return process.env.DEBUG === "1";
}

function log(...args) {
  if (debug()) {
    console.log("[openai]", ...args);
  }
}

function parseSseText(sseBody) {
  const lines = sseBody.split("\n");
  let text = "";
  let currentEvent = "";

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const json = JSON.parse(data);
      if (currentEvent === "response.output_text.delta" && json.delta) {
        text += json.delta;
      } else if (json.type === "response.output_text.delta" && json.delta) {
        text += json.delta;
      } else if (
        json.response?.output?.[0]?.content?.[0]?.text
      ) {
        text += json.response.output[0].content[0].text;
      }
    } catch {
      // skip malformed SSE chunks
    }
  }

  return text;
}

export async function sendChatMessage(tokens, message) {
  if (!tokens) {
    throw new Error("Not authenticated");
  }

  if (tokens.mock || mockMode()) {
    return { text: `Mock reply to: ${message}` };
  }

  const userInfo = getUserInfoFromToken(tokens.access_token);
  if (!userInfo?.accountId) {
    throw new Error(
      "Could not extract chatgpt_account_id from access token.",
    );
  }

  const body = {
    model: model(),
    instructions: "You are a helpful assistant.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: message }],
      },
    ],
    store: false,
    stream: true,
  };

  log("sending chat request, model", model());

  const response = await fetch(CODEX_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokens.access_token}`,
      "chatgpt-account-id": userInfo.accountId,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
      session_id: randomUUID(),
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Codex API failed (${response.status})${text ? `: ${text}` : ""}`,
    );
  }

  const sseBody = await response.text();
  const text = parseSseText(sseBody).trim();
  if (!text) {
    log("empty SSE body snippet:", sseBody.slice(0, 500));
    throw new Error("Empty response from Codex API (SSE parse found no text).");
  }

  return { text };
}
