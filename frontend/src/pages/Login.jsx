import { useState } from "react";

export default function Login({ onStart, loading, error }) {
  return (
    <div className="card">
      <h1>Login with ChatGPT</h1>
      <p className="muted">
        Uses the unofficial Codex device-code OAuth flow (same as Codex CLI).
        Requires a ChatGPT Plus/Pro subscription.
      </p>
      <button type="button" onClick={onStart} disabled={loading}>
        {loading ? "Starting…" : "Login with ChatGPT"}
      </button>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
