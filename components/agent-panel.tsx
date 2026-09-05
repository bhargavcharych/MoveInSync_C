"use client";

import { useMemo, useRef, useState } from "react";
import { Bot, ChevronDown, Send, Sparkles, UserRound } from "lucide-react";
import type { ChatMessage, DashboardFilters, Persona, UiBlock } from "@/lib/types";

const starters: Record<Persona, string[]> = {
  transport_manager: ["Which vendors need attention?", "Show me the riskiest trips", "What is driving the SLA gap?"],
  facilities_head: ["Give me a leadership summary", "Compare vendor value", "How is sustainability trending?"],
  line_manager: ["Which shifts are at risk?", "Show late pickup exposure", "Where are no-shows highest?"],
};

function GeneratedBlock({ block }: { block: UiBlock }) {
  if (block.type === "metrics") return (
    <div className="agent-block">
      <div className="agent-block-title">{block.title}</div>
      <div className="agent-metrics">{block.items.map((item) => (
        <div key={item.label}><span>{item.label}</span><strong className={item.tone === "risk" ? "text-risk" : item.tone === "good" ? "text-good" : ""}>{item.value}</strong></div>
      ))}</div>
    </div>
  );
  if (block.type === "bars") {
    const max = Math.max(...block.items.map((i) => i.value), 1);
    return <div className="agent-block"><div className="agent-block-title">{block.title}</div><div className="mini-bars">{block.items.map((item) => (
      <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${item.value / max * 100}%` }} /></i><strong>{item.value.toLocaleString("en-IN")}{item.suffix}</strong></div>
    ))}</div></div>;
  }
  return (
    <div className="agent-block"><div className="agent-block-title">{block.title}</div><div className="mini-table"><table><thead><tr>{block.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div></div>
  );
}

export function AgentPanel({ persona, filters, mode, collapsed, onToggle }: { persona: Persona; filters: Omit<DashboardFilters, "persona">; mode: "command" | "monitoring"; collapsed: boolean; onToggle: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "assistant",
    content: "I’m watching the selected slice of mobility operations. Ask me to compare an SLA, find a root cause, or build an action queue.",
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const apiHistory = useMemo(() => messages.map(({ role, content }) => ({ role, content })).slice(-8), [messages]);

  async function send(text = input) {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setInput("");
    setMessages((old) => [...old, { role: "user", content: prompt }]);
    setBusy(true);
    queueMicrotask(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: prompt, persona, mode, filters, history: apiHistory }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Agent unavailable");
      setMessages((old) => [...old, { role: "assistant", content: data.answer, blocks: data.blocks }]);
    } catch (error) {
      setMessages((old) => [...old, { role: "assistant", content: error instanceof Error ? error.message : "I couldn’t complete that analysis." }]);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <aside className={`agent-panel ${collapsed ? "collapsed" : ""}`}>
      <button className="agent-header" onClick={onToggle} aria-expanded={!collapsed}>
        <span className="agent-avatar"><Sparkles size={17} /></span>
        <span><strong>Mobility Copilot</strong><small><i /> Sarvam 105B · live API</small></span>
        <ChevronDown size={17} />
      </button>
      {!collapsed && <>
        <div className="agent-context"><span>Context</span><strong>{mode === "monitoring" ? "Live monitoring" : filters.businessUnit || "All business units"}</strong><b>·</b><strong>{mode === "monitoring" ? "Real-time" : filters.month || "May–Jul"}</strong></div>
        <div className="agent-messages">
          {messages.map((message, index) => (
            <div className={`message ${message.role}`} key={index}>
              <div className="message-icon">{message.role === "assistant" ? <Bot size={15} /> : <UserRound size={15} />}</div>
              <div className="message-body"><p>{message.content}</p>{message.blocks?.map((block, i) => <GeneratedBlock block={block} key={i} />)}</div>
            </div>
          ))}
          {busy && <div className="message assistant"><div className="message-icon"><Bot size={15} /></div><div className="agent-thinking"><i /><i /><i /></div></div>}
          <div ref={endRef} />
        </div>
        {messages.length < 3 && <div className="prompt-starters">{(mode === "monitoring" ? ["What needs intervention now?", "Explain the latest AI severity", "Which vendor is repeating violations?"] : starters[persona]).map((starter) => <button key={starter} onClick={() => send(starter)}>{starter}</button>)}</div>}
        <div className="agent-compose">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about SLA, vendors, trips…" rows={2} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button onClick={() => send()} disabled={!input.trim() || busy} aria-label="Send"><Send size={16} /></button>
          <small>Real Sarvam API · claims constrained to approved read-only tools.</small>
        </div>
      </>}
    </aside>
  );
}
