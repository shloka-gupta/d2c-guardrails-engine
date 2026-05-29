import { useState, useRef, useEffect } from "react";
import axios from "axios";

const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

export default function App() {
  const [messages, setMessages] = useState([
    { role: "bot", text: "Hey! Which brand do you want to analyze? Just type the brand name." }
  ]);
  const [input, setInput]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [brand, setBrand]       = useState(null);
  const bottomRef               = useRef(null);

  // Auto scroll to bottom on new message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addMessage(role, text) {
    setMessages(prev => [...prev, { role, text }]);
  }

  // Poll job status every 2 seconds
  async function pollJob(jobId) {
    const interval = setInterval(async () => {
      try {
        const { data } = await axios.get(`${SERVER}/status/${jobId}`);

        // Update the last bot message with current steps
        const stepText = data.steps.join("\n");
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "bot", text: stepText };
          return updated;
        });

        // If done, stop polling and show summary
        if (data.done) {
          clearInterval(interval);
          setLoading(false);

          if (data.error) {
            addMessage("bot", `❌ Pipeline failed: ${data.error}`);
            return;
          }

          const s = data.summary;
          addMessage("bot",
            `🎉 Done! Here's what I found about **${data.brand}**:\n\n` +
            `🔴 ${s.block} blocks  🟡 ${s.warn} warnings  🟢 ${s.pass} passes\n\n` +
            `Ask me anything about this brand or test a campaign idea!`
          );
          setBrand(data.brand);
        }
      } catch (err) {
        clearInterval(interval);
        setLoading(false);
        addMessage("bot", "Something went wrong while checking pipeline status.");
      }
    }, 2000);
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    addMessage("user", userMessage);
    setLoading(true);

    try {
      const { data } = await axios.post(`${SERVER}/chat`, {
        message: userMessage,
        brand,
        history: messages.map(m => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.text
        }))
      });

      if (data.action === "pipeline_started") {
        // Show initial message and start polling
        addMessage("bot", `🚀 Starting analysis for **${data.brand}**...\n`);
        pollJob(data.jobId);
        if (data.brand) setBrand(data.brand);

      } else if (data.action === "loaded") {
        // Brand already in memory
        addMessage("bot", data.reply);
        if (data.brand) setBrand(data.brand);
        setLoading(false);

      } else {
        // Conversational, campaign result, analysis result
        addMessage("bot", data.reply);
        if (data.brand) setBrand(data.brand);
        setLoading(false);
      }

    } catch (err) {
      addMessage("bot", "Server error. Make sure the backend is running.");
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100vh", maxWidth: "720px",
      margin: "0 auto", fontFamily: "sans-serif"
    }}>

      {/* Header */}
      <div style={{
        padding: "16px 24px",
        borderBottom: "1px solid #eee",
        display: "flex", alignItems: "center", gap: "12px"
      }}>
        <div style={{ fontSize: "20px" }}>🛡️</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: "16px" }}>D2C Guardrails Engine</div>
          <div style={{ fontSize: "12px", color: "#888" }}>
            {brand ? `Analyzing: ${brand}` : "No brand loaded"}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1, overflowY: "auto",
        padding: "24px", display: "flex",
        flexDirection: "column", gap: "12px"
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex",
            justifyContent: m.role === "user" ? "flex-end" : "flex-start"
          }}>
            <div style={{
              maxWidth: "80%",
              padding: "10px 14px",
              borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: m.role === "user" ? "#000" : "#f4f4f4",
              color: m.role === "user" ? "#fff" : "#000",
              fontSize: "14px", lineHeight: "1.6",
              whiteSpace: "pre-wrap"
            }}>
              {m.text}
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {loading && messages[messages.length - 1]?.role !== "bot" && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div style={{
              padding: "10px 14px", borderRadius: "18px 18px 18px 4px",
              background: "#f4f4f4", fontSize: "14px", color: "#888"
            }}>
              ⏳ thinking...
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "16px 24px",
        borderTop: "1px solid #eee",
        display: "flex", gap: "8px"
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a brand name or ask anything..."
          disabled={loading}
          rows={1}
          style={{
            flex: 1, padding: "10px 14px",
            borderRadius: "12px", border: "1px solid #ddd",
            fontSize: "14px", resize: "none",
            fontFamily: "sans-serif", outline: "none"
          }}
        />
        <button
          onClick={sendMessage}
          disabled={loading || !input.trim()}
          style={{
            padding: "10px 20px",
            borderRadius: "12px",
            border: "none",
            background: loading ? "#ccc" : "#000",
            color: "#fff",
            fontSize: "14px",
            cursor: loading ? "not-allowed" : "pointer"
          }}
        >
          Send
        </button>
      </div>

    </div>
  );
}