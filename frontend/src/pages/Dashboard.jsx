import { useState } from "react";

export default function Dashboard({ user, onLogout, onSend }) {
  const [message, setMessage] = useState("hi");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSend(e) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;

    setLoading(true);
    setError(null);
    setResponse("");

    try {
      const reply = await onSend(text);
      setResponse(reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h1>You are logged in</h1>
      {user ? (
        <p className="muted">
          {user.email ?? "Signed in"}
          {user.planType ? ` · ${user.planType}` : ""}
          {user.mock ? " (mock)" : ""}
        </p>
      ) : null}

      <form onSubmit={handleSend}>
        <div className="row">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Say something…"
            disabled={loading}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Sending…" : "Send"}
          </button>
        </div>
      </form>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {response ? (
        <div className="response" aria-live="polite">
          {response}
        </div>
      ) : null}

      <div style={{ marginTop: "1.25rem" }}>
        <button type="button" className="secondary" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}
