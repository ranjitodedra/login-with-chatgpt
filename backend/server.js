import path from "node:path";
import { fileURLToPath } from "node:url";

import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import session from "express-session";

import {
  ensureFreshTokens,
  getUserInfoFromToken,
  pollDeviceAuth,
  startDeviceAuth,
} from "./auth.js";
import { sendChatMessage } from "./openai.js";
import { clearSessionData, getSessionData } from "./session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const app = express();
const port = Number(process.env.PORT ?? 3091);
const debug = process.env.DEBUG === "1";

app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use(
  session({
    name: "login_test_sid",
    secret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);

function sessionKey(req) {
  return req.sessionID;
}

function touchSession(req) {
  req.session.authenticated = req.session.authenticated ?? false;
}

app.post("/auth/start", async (req, res) => {
  try {
    touchSession(req);
    const deviceAuth = await startDeviceAuth();
    const data = getSessionData(sessionKey(req));
    data.deviceAuth = deviceAuth;
    data.tokens = null;
    res.json({
      user_code: deviceAuth.user_code,
      verification_uri: deviceAuth.verification_uri,
      interval: deviceAuth.interval,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to start auth",
    });
  }
});

app.post("/auth/poll", async (req, res) => {
  touchSession(req);
  const data = getSessionData(sessionKey(req));
  if (!data.deviceAuth) {
    return res.status(400).json({
      status: "error",
      message: "No device auth in progress. Call /auth/start first.",
    });
  }

  if (debug) {
    data.pollCount = (data.pollCount ?? 0) + 1;
    console.log("[poll] attempt", data.pollCount);
  }

  const result = await pollDeviceAuth(data.deviceAuth);
  if (result.status === "complete") {
    data.tokens = result.tokens;
    data.deviceAuth = null;
    if (result.tokens.mock) {
      data.tokens.mock = true;
    }
  }
  res.json(result);
});

app.get("/me", (req, res) => {
  touchSession(req);
  const data = getSessionData(sessionKey(req));
  if (!data.tokens) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  if (data.tokens.mock) {
    return res.json({
      email: "mock@example.com",
      accountId: "mock-account",
      planType: "plus",
      mock: true,
    });
  }

  const info = getUserInfoFromToken(data.tokens.access_token);
  if (!info) {
    return res.status(401).json({ error: "Invalid token" });
  }
  res.json(info);
});

app.post("/chat", async (req, res) => {
  touchSession(req);
  const data = getSessionData(sessionKey(req));
  if (!data.tokens) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const message = req.body?.message?.trim();
  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  try {
    data.tokens = await ensureFreshTokens(data.tokens);
    const result = await sendChatMessage(data.tokens, message);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Chat request failed",
    });
  }
});

app.post("/auth/logout", (req, res) => {
  clearSessionData(sessionKey(req));
  req.session.destroy(() => {
    res.clearCookie("login_test_sid");
    res.json({ ok: true });
  });
});

app.listen(port, () => {
  console.log(`login-test backend listening on http://localhost:${port}`);
  if (process.env.MOCK_MODE === "1") {
    console.log("MOCK_MODE=1 — auth and chat will use fake responses");
  }
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the other backend (netstat -ano | findstr :${port}) or change PORT in login-test/.env`,
    );
    process.exit(1);
  }
  throw err;
});
