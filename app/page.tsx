"use client";

import { useState, type FormEvent } from "react";

type Message = {
  role: "user" | "assistant";
  text: string;
};

export default function ChatPage() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || !text.trim()) return;

    const message = text;
    const history = [...messages, { role: "user" as const, text: message }];
    setIsSending(true);
    setError(null);

    try {
      // Memory: the whole conversation is sent on every request.
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.text })),
        }),
      });
      const data: unknown = await response.json();

      if (!response.ok) {
        const detail =
          typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to send your message. Please try again.";
        throw new Error(detail);
      }

      if (typeof data !== "object" || data === null || !("answer" in data) || typeof data.answer !== "string") {
        throw new Error("The server returned an invalid reply. Please try again.");
      }

      setMessages([...history, { role: "assistant", text: data.answer }]);
      setText("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to send your message. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="chat">
      <h1>Support chat</h1>
      <p>The assistant remembers the conversation.</p>
      <section className="messages" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && <p>No messages yet.</p>}
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={index}>
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            <p>{message.text}</p>
          </div>
        ))}
      </section>
      <form onSubmit={sendMessage} aria-busy={isSending}>
        <label htmlFor="message">Your message</label>
        <textarea
          id="message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Describe what you need help with..."
          rows={3}
          required
          disabled={isSending}
        />
        <div className="row">
          <button type="button" className="secondary" onClick={() => setMessages([])} disabled={isSending}>
            New conversation
          </button>
          <button type="submit" disabled={isSending || !text.trim()}>
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
