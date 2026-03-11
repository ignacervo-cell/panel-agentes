import { useState, useRef, useEffect } from "react";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const WEB_SEARCH_TOOL = [{ type: "web_search_20250305", name: "web_search" }];

const SYSTEM_JUDICIAL = `Eres un experto en comunicación judicial argentina con acceso a búsqueda web. Podés buscar información, leer URLs y acceder a contenido online cuando sea necesario.

Cuando el usuario te comparta contenido o URL, generás el Doble Producto:

1. FICHA TÉCNICA (Uso Interno)
- Datos Duros: Expediente, fecha exacta (con hora si figura), montos con centavos, dominios de vehículos.
- Intervinientes: Nombre real de Jueces/Juezas (solo primer nombre y apellido como título de grado), Fiscales y Defensores.
- Cronología: Hecho → Primera Instancia → Segunda Instancia (Cámara).

2. NOTA DE PRENSA (Difusión)
- Lenguaje Claro: Traduce términos jurídicos a lenguaje accesible.
- Enfoque Institucional: Nombra al organismo, no al magistrado.
- Redondeo: Cifras económicas redondeadas.
- Protocolo de Anonimato: Menores, familia o delitos sexuales → anonimizar totalmente.
- Citas Textuales: Incluí fragmentos clave de la sentencia.

RESTRICCIONES:
- Prohibido inventar datos que no estén en el texto o en la búsqueda.
- Sin consejos ni párrafos preventivos.
- Localidad: mencioná la ciudad al inicio de la nota.`;

const SYSTEM_LIBRE = `Sos Claude, un asistente de IA creado por Anthropic. Tenés acceso a búsqueda web: podés leer URLs, buscar información actual, analizar páginas y responder cualquier consulta con datos reales. Cuando el usuario comparte una URL o pide información de un sitio, usá la herramienta de búsqueda para acceder al contenido. Respondé siempre en español. Sé directo y preciso.`;

const AGENTS = [
  {
    id: "judicial",
    label: "Agente Judicial",
    icon: "⚖️",
    accent: "#1a56a0",
    tag: "COMUNICACIÓN JUDICIAL",
    placeholder: "Pegá texto, URL de resolución o expediente...",
    system: SYSTEM_JUDICIAL,
  },
  {
    id: "libre",
    label: "Agente Libre",
    icon: "🤖",
    accent: "#6c3fc5",
    tag: "ASISTENTE GENERAL",
    placeholder: "Escribí lo que necesitás o pegá una URL...",
    system: SYSTEM_LIBRE,
  },
];

function TypingDots({ color }) {
  return (
    <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 8, height: 8, borderRadius: "50%", background: color,
          display: "inline-block",
          animation: `dot 1.2s ${i * 0.2}s infinite ease-in-out`,
        }} />
      ))}
      <style>{`@keyframes dot{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
    </span>
  );
}

function getTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(b => b.type === "text").map(b => b.text).join("");
  }
  return "";
}

function Bubble({ msg, accent }) {
  if (msg.role === "tool") return null;
  const isUser = msg.role === "user";
  const text = getTextFromContent(msg.content);
  if (!text) return null;
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 10, animation: "fi 0.2s ease" }}>
      <style>{`@keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
      <div style={{
        maxWidth: "78%",
        padding: "10px 14px",
        borderRadius: isUser ? "16px 16px 3px 16px" : "16px 16px 16px 3px",
        background: isUser ? accent : "#f0f2f5",
        color: isUser ? "#fff" : "#1a1a1a",
        fontSize: 14,
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        boxShadow: isUser ? `0 2px 8px ${accent}44` : "0 1px 3px rgba(0,0,0,0.08)",
      }}>
        {text}
      </div>
    </div>
  );
}

export default function App() {
  const [activeId, setActiveId] = useState("judicial");
  const [histories, setHistories] = useState({ judicial: [], libre: [] });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const bottomRef = useRef(null);

  const agent = AGENTS.find(a => a.id === activeId);
  const messages = histories[activeId];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, status]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    const newHistory = [...messages, userMsg];
    setHistories(h => ({ ...h, [activeId]: newHistory }));
    setInput("");
    setLoading(true);
    setStatus("");

    try {
      let convo = [...newHistory];

      while (true) {
        const res = await fetch(ANTHROPIC_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            system: agent.system,
            tools: WEB_SEARCH_TOOL,
            messages: convo,
          }),
        });

        const data = await res.json();
        if (!data.content) throw new Error("Sin respuesta");

        convo = [...convo, { role: "assistant", content: data.content }];

        if (data.stop_reason === "end_turn") {
          const reply = getTextFromContent(data.content);
          setHistories(h => ({
            ...h,
            [activeId]: [...newHistory, { role: "assistant", content: reply }],
          }));
          break;
        }

        if (data.stop_reason === "tool_use") {
          setStatus("🔍 Buscando en la web...");
          const toolUseBlocks = data.content.filter(b => b.type === "tool_use");
          const toolResults = toolUseBlocks.map(block => ({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Búsqueda completada.",
          }));
          convo = [...convo, { role: "user", content: toolResults }];
          continue;
        }

        // Fallback
        const fallback = getTextFromContent(data.content);
        if (fallback) {
          setHistories(h => ({
            ...h,
            [activeId]: [...newHistory, { role: "assistant", content: fallback }],
          }));
        }
        break;
      }
    } catch {
      setHistories(h => ({
        ...h,
        [activeId]: [...newHistory, { role: "assistant", content: "Error al conectar con la API." }],
      }));
    } finally {
      setLoading(false);
      setStatus("");
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  }

  return (
    <div style={{
      minHeight: "100vh",
      background: "#eef1f6",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      fontFamily: "'Segoe UI', Arial, sans-serif",
      padding: "24px 12px",
    }}>
      <div style={{ width: "100%", maxWidth: 700, marginBottom: 18 }}>
        <div style={{ color: "#999", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 2 }}>
          Ignacio Soto · Trelew
        </div>
        <h1 style={{ margin: "0 0 16px", fontSize: 20, fontWeight: 700, color: "#1a1a2e" }}>
          Panel de Agentes
        </h1>

        <div style={{ display: "flex", gap: 10 }}>
          {AGENTS.map(a => (
            <button
              key={a.id}
              onClick={() => { setActiveId(a.id); setStatus(""); }}
              style={{
                flex: 1,
                padding: "12px 10px",
                borderRadius: 12,
                border: activeId === a.id ? `2px solid ${a.accent}` : "2px solid #dde1ea",
                background: activeId === a.id ? "#fff" : "#f5f7fa",
                color: activeId === a.id ? a.accent : "#999",
                cursor: "pointer",
                fontFamily: "inherit",
                fontWeight: 600,
                fontSize: 14,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                boxShadow: activeId === a.id ? `0 3px 14px ${a.accent}22` : "none",
                transition: "all 0.2s",
              }}
            >
              <span style={{ fontSize: 22 }}>{a.icon}</span>
              <span style={{ fontSize: 10, letterSpacing: 1, color: activeId === a.id ? a.accent : "#bbb" }}>
                {a.tag}
              </span>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{
        width: "100%",
        maxWidth: 700,
        background: "#fff",
        borderRadius: 18,
        boxShadow: "0 4px 24px rgba(0,0,0,0.10)",
        border: `1px solid ${agent.accent}33`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "border-color 0.3s",
      }}>
        <div style={{
          padding: "12px 18px",
          borderBottom: "1px solid #eee",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#fafbfd",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>{agent.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, color: agent.accent }}>{agent.label}</div>
              <div style={{ fontSize: 10, color: "#bbb", letterSpacing: 1 }}>{agent.tag} · 🌐 Web Search</div>
            </div>
          </div>
          <button
            onClick={() => setHistories(h => ({ ...h, [activeId]: [] }))}
            style={{
              background: "none", border: "1px solid #e0e0e0", color: "#999",
              fontSize: 11, padding: "4px 12px", borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Limpiar
          </button>
        </div>

        <div style={{
          minHeight: 360,
          maxHeight: 460,
          overflowY: "auto",
          padding: "18px 16px 8px",
          scrollbarWidth: "thin",
          scrollbarColor: "#ddd transparent",
        }}>
          {messages.length === 0 && (
            <div style={{ textAlign: "center", color: "#ccc", fontSize: 13, marginTop: 80, lineHeight: 2 }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>{agent.icon}</div>
              <div>{agent.placeholder}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} msg={m} accent={agent.accent} />
          ))}
          {loading && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 10 }}>
              <div style={{
                padding: "10px 16px",
                borderRadius: "16px 16px 16px 3px",
                background: "#f0f2f5",
                display: "flex", flexDirection: "column", gap: 6,
              }}>
                {status && <div style={{ fontSize: 12, color: "#888" }}>{status}</div>}
                <TypingDots color={agent.accent} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{
          padding: "12px 14px",
          borderTop: "1px solid #eee",
          display: "flex",
          gap: 10,
          alignItems: "flex-end",
          background: "#fafbfd",
        }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder={agent.placeholder}
            rows={2}
            style={{
              flex: 1,
              background: "#f0f2f5",
              border: `1.5px solid ${input ? agent.accent + "88" : "#e0e4ea"}`,
              borderRadius: 12,
              color: "#1a1a1a",
              fontSize: 14,
              padding: "10px 14px",
              fontFamily: "inherit",
              resize: "none",
              outline: "none",
              lineHeight: 1.5,
              transition: "border-color 0.2s",
            }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              background: loading || !input.trim() ? "#e0e4ea" : agent.accent,
              border: "none",
              borderRadius: 12,
              color: loading || !input.trim() ? "#aaa" : "#fff",
              fontSize: 18,
              width: 46,
              height: 46,
              cursor: loading || !input.trim() ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: loading || !input.trim() ? "none" : `0 3px 12px ${agent.accent}55`,
            }}
          >
            ↑
          </button>
        </div>
      </div>

      <div style={{ marginTop: 14, fontSize: 11, color: "#bbb", letterSpacing: 1 }}>
        ENTER para enviar · SHIFT+ENTER nueva línea
      </div>
    </div>
  );
}
