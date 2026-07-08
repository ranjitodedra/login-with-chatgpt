import { useCallback, useEffect, useRef, useState } from "react";

import Dashboard from "./pages/Dashboard.jsx";
import Login from "./pages/Login.jsx";

const api = (path, options = {}) =>
  fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

function DeviceCodeScreen({ device, pollError, polling }) {
  return (
    <div className="card">
      <h1>Sign in with ChatGPT</h1>
      <p>1. Open this URL in your browser:</p>
      <p>
        <a href={device.verification_uri} target="_blank" rel="noreferrer">
          {device.verification_uri}
        </a>
      </p>
      <p>2. Enter this one-time code:</p>
      <div className="code">{device.user_code}</div>
      <p className="muted">
        {polling
          ? "Waiting for you to approve access…"
          : "Code expires in 15 minutes."}
      </p>
      {pollError ? (
        <p className="error" role="alert">
          {pollError}
        </p>
      ) : null}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("loading");
  const [user, setUser] = useState(null);
  const [device, setDevice] = useState(null);
  const [loginError, setLoginError] = useState(null);
  const [pollError, setPollError] = useState(null);
  const [starting, setStarting] = useState(false);
  const pollTimer = useRef(null);

  const loadMe = useCallback(async () => {
    const res = await api("/me");
    if (res.ok) {
      setUser(await res.json());
      setScreen("dashboard");
      return true;
    }
    setScreen("login");
    return false;
  }, []);

  useEffect(() => {
    loadMe();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [loadMe]);

  async function startPoll(intervalSeconds) {
    const poll = async () => {
      try {
        const res = await api("/auth/poll", { method: "POST" });
        const data = await res.json();

        if (data.status === "complete") {
          await loadMe();
          return;
        }
        if (data.status === "error") {
          setPollError(data.message ?? "Authorization failed");
          return;
        }
        pollTimer.current = setTimeout(poll, intervalSeconds * 1000);
      } catch {
        setPollError("Poll request failed");
      }
    };
    poll();
  }

  async function handleLoginStart() {
    setStarting(true);
    setLoginError(null);
    setPollError(null);

    try {
      const res = await api("/auth/start", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start login");
      }
      setDevice(data);
      setScreen("device");
      await startPoll(data.interval ?? 5);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  async function handleSend(message) {
    const res = await api("/chat", {
      method: "POST",
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? "Chat failed");
    }
    return data.text;
  }

  async function handleLogout() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setDevice(null);
    setScreen("login");
  }

  return (
    <>
      <div className="warning">
        <strong>Demo only.</strong> Unofficial Codex device-code flow — not an
        official Login with ChatGPT SDK. APIs may change or break anytime.
      </div>

      {screen === "loading" ? (
        <div className="card">
          <p className="muted">Loading…</p>
        </div>
      ) : null}

      {screen === "login" ? (
        <Login
          onStart={handleLoginStart}
          loading={starting}
          error={loginError}
        />
      ) : null}

      {screen === "device" && device ? (
        <DeviceCodeScreen
          device={device}
          pollError={pollError}
          polling={!pollError}
        />
      ) : null}

      {screen === "dashboard" ? (
        <Dashboard user={user} onLogout={handleLogout} onSend={handleSend} />
      ) : null}
    </>
  );
}
