"use client";

import { Bot, ExternalLink, LoaderCircle, Send, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";

type Model = { id: string; model: string; displayName: string; isDefault?: boolean; upgrade?: string | null; supportedReasoningEfforts?: Array<{ reasoningEffort: string }>; defaultReasoningEffort?: string };
type Message = { role: "user" | "assistant"; text: string };
type Status = { account: { type?: string; email?: string | null; planType?: string } | null; models: Model[]; rateLimits: any; rateLimitsByLimitId: Record<string, any> | null };
const THREAD_KEY = "layerling.codexAssistant.thread";
const MESSAGES_KEY = "layerling.codexAssistant.messages";

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not reach Codex.");
  return result as T;
}

function remaining(window: any) {
  return typeof window?.usedPercent === "number" ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null;
}

export function CodexAssistant() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [modelId, setModelId] = useState("auto");
  const [effort, setEffort] = useState("medium");
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState("");
  const [quotaOpen, setQuotaOpen] = useState(false);
  const cursor = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      setThreadId(localStorage.getItem(THREAD_KEY) || "");
      setMessages(JSON.parse(localStorage.getItem(MESSAGES_KEY) || "[]"));
    } catch { /* Private browsing may block local storage. */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-80))); } catch { /* Conversation still works this visit. */ }
  }, [messages]);

  const refreshStatus = useCallback(async () => {
    setError("");
    try { setStatus(await callApi<Status>("/api/codex-assistant")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect to Codex."); }
  }, []);

  useEffect(() => { if (open) void refreshStatus(); }, [open, refreshStatus]);
  useEffect(() => {
    if (!loginPending) return;
    const timeout = window.setTimeout(() => setLoginPending(false), 10 * 60 * 1000);
    return () => window.clearTimeout(timeout);
  }, [loginPending]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages, activity]);
  useEffect(() => { if (open && !busy) inputRef.current?.focus(); }, [open, busy]);

  useEffect(() => {
    if (!open || (!busy && !loginPending)) return;
    let alive = true;
    const poll = async () => {
      try {
        const result = await callApi<{ events: Array<{ id: number; type: string; text?: string; data?: any }>; latest: number; running: boolean }>(`/api/codex-assistant?action=events&since=${cursor.current}`);
        if (!alive) return;
        let turnFinished = false;
        let authChanged = false;
        for (const event of result.events) {
          cursor.current = Math.max(cursor.current, event.id);
          if (event.type === "delta" && event.text) {
            setMessages((current) => {
              const last = current.at(-1);
              return last?.role === "assistant" ? [...current.slice(0, -1), { ...last, text: last.text + event.text }] : [...current, { role: "assistant", text: event.text! }];
            });
          } else if (event.type === "turnStarted" || event.type === "tool") setActivity(t("codexAssistant.working"));
          else if (event.type === "turn") {
            const turn = event.data as { status?: string; error?: { message?: string } } | undefined;
            turnFinished = true;
            setActivity("");
            if (turn?.status === "failed") setError(turn.error?.message || t("codexAssistant.failed"));
            if (turn?.status === "interrupted") setActivity(t("codexAssistant.stopped"));
          } else if (event.type === "status") {
            const data = event.data as { method?: string; params?: { success?: boolean; error?: string | null; authMode?: string | null } } | undefined;
            if (data?.method === "account/login/completed") {
              setLoginPending(false);
              authChanged = Boolean(data.params?.success);
              if (!data.params?.success) setError(data.params?.error || t("codexAssistant.loginFailed"));
            } else if (data?.method === "account/updated") {
              setLoginPending(false);
              authChanged = true;
            }
          } else if (event.type === "process") {
            setActivity("");
            setError(t("codexAssistant.failed"));
          }
        }
        if (authChanged) void refreshStatus();
        if (result.running || loginPending || (busy && activity === t("codexAssistant.starting"))) window.setTimeout(poll, 650);
        else if (busy && (turnFinished || !result.running)) { setBusy(false); void refreshStatus(); }
      } catch (cause) {
        if (alive) { setBusy(false); setError(cause instanceof Error ? cause.message : t("codexAssistant.failed")); }
      }
    };
    void poll();
    return () => { alive = false; };
  }, [busy, loginPending, open, activity, refreshStatus]);

  const startLogin = async () => {
    setError("");
    try {
      const result = await callApi<{ authUrl?: string }>("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login" }) });
      if (result.authUrl) { window.open(result.authUrl, "_blank", "noopener,noreferrer"); setLoginPending(true); }
      else setError(t("codexAssistant.loginFailed"));
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("codexAssistant.loginFailed")); }
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || busy || !status?.account) return;
    const model = modelId === "auto" ? chooseAutomaticModel(status.models, text) : status.models.find((item) => item.id === modelId || item.model === modelId);
    if (!model) { setError(t("codexAssistant.noModels")); return; }
    const availableEfforts = model.supportedReasoningEfforts?.map((option) => option.reasoningEffort) ?? [];
    const simple = /\b(würfel|quader|zylinder|cube|cuboid|cylinder)\b/i.test(text) && text.length < 120;
    const complex = text.length > 240 || /\b(mehrere|komplex|hohl|aushöhlen|boolean|bohrungen|halterung|pattern|multiple|hollow|sweep|fillet|chamfer)\b/i.test(text);
    const autoEffort = simple ? "low" : complex ? "high" : model.defaultReasoningEffort || "medium";
    const chosenEffort = modelId === "auto" ? (availableEfforts.includes(autoEffort) ? autoEffort : model.defaultReasoningEffort || availableEfforts[0] || "medium") : (availableEfforts.includes(effort) ? effort : model.defaultReasoningEffort || availableEfforts[0] || "medium");
    setError(""); setActivity(t("codexAssistant.starting")); setBusy(true); setDraft("");
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      const result = await callApi<{ threadId: string }>("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", text, threadId: threadId || null, model: model.id || model.model, effort: chosenEffort }) });
      setThreadId(result.threadId);
      try { localStorage.setItem(THREAD_KEY, result.threadId); } catch { /* In-memory continuation remains available. */ }
      setActivity(t("codexAssistant.working"));
    } catch (cause) {
      setBusy(false); setActivity(""); setMessages((current) => current.at(-1)?.role === "assistant" ? current.slice(0, -1) : current);
      setError(cause instanceof Error ? cause.message : t("codexAssistant.failed"));
    }
  };

  const cancel = async () => {
    try { await callApi("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel" }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("codexAssistant.failed")); }
  };

  const newChat = () => {
    if (busy) return;
    setThreadId(""); setMessages([]); setActivity(""); cursor.current = 0;
    try { localStorage.removeItem(THREAD_KEY); localStorage.removeItem(MESSAGES_KEY); } catch { /* In-memory state is cleared. */ }
  };

  const quota = status?.rateLimitsByLimitId?.codex ?? status?.rateLimits;
  const windows = [quota?.primary, quota?.secondary].filter(Boolean);
  const selectedModel = status?.models.find((item) => item.id === modelId || item.model === modelId) ?? status?.models.find((item) => item.isDefault) ?? status?.models[0];
  const effortOptions = selectedModel?.supportedReasoningEfforts?.map((item) => item.reasoningEffort) ?? ["low", "medium", "high"];
  return <>
    <button className="codex-assistant-launcher" type="button" aria-label={t("codexAssistant.open")} title={t("codexAssistant.open")} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Sparkles size={20} aria-hidden="true" />
    </button>
    {open ? <section className="codex-assistant-panel" role="dialog" aria-label={t("codexAssistant.title")}>
      <header className="codex-assistant-header">
        <div className="codex-assistant-heading"><Bot size={19} aria-hidden="true" /><div><strong>{t("codexAssistant.title")}</strong><small>{status?.account?.type === "chatgpt" ? t("codexAssistant.connected") : t("codexAssistant.localCodex")}</small></div></div>
        <div className="codex-assistant-header-actions">
          {windows.length ? <button type="button" className="codex-assistant-quota-trigger" onClick={() => setQuotaOpen((value) => !value)} aria-expanded={quotaOpen} title={t("codexAssistant.usage")}>{windows.map((item: any, index: number) => <span key={index}>{remaining(item) === null ? "—" : `${remaining(item)}%`}</span>)}</button> : null}
          {threadId && !busy ? <button type="button" className="codex-assistant-icon-button" title={t("codexAssistant.newChat")} aria-label={t("codexAssistant.newChat")} onClick={newChat}><Sparkles size={16} /></button> : null}
          <button type="button" className="codex-assistant-icon-button" title={t("codexAssistant.close")} aria-label={t("codexAssistant.close")} onClick={() => setOpen(false)}><X size={17} /></button>
        </div>
      </header>
      {quotaOpen ? <div className="codex-assistant-quota">
        {windows.map((item: any, index: number) => <div key={index} className="codex-assistant-quota-row"><span>{item.windowDurationMins ? t("codexAssistant.window", { minutes: item.windowDurationMins }) : t("codexAssistant.usageWindow", { number: index + 1 })}</span><strong>{remaining(item) === null ? "—" : `${remaining(item)}%`}</strong><meter min="0" max="100" value={remaining(item) ?? 0} /><small>{item.resetsAt ? t("codexAssistant.resets", { time: new Date(item.resetsAt * 1000).toLocaleString() }) : t("codexAssistant.resetUnavailable")}</small></div>)}
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">{t("codexAssistant.manageUsage")} <ExternalLink size={12} /></a>
      </div> : null}
      {!status?.account ? <div className="codex-assistant-setup">
        <p>{error || t("codexAssistant.connectDescription")}</p>
        <button type="button" className="codex-assistant-primary" onClick={() => void startLogin()}>{t("codexAssistant.connect")}</button>
        <p className="codex-assistant-footnote">{t("codexAssistant.localOnly")}</p>
      </div> : <>
        <div className="codex-assistant-controls">
          <label><span>{t("codexAssistant.model")}</span><select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="auto">{t("codexAssistant.automatic")}</option>{status.models.map((model) => <option key={model.id} value={model.id}>{model.displayName || model.id}</option>)}</select></label>
          <label><span>{t("codexAssistant.reasoning")}</span><select value={effort} onChange={(event) => setEffort(event.target.value)}>{effortOptions.map((option) => <option value={option} key={option}>{option === "xhigh" ? t("codexAssistant.extraHigh") : option[0].toUpperCase() + option.slice(1)}</option>)}</select></label>
        </div>
        <div className="codex-assistant-messages" ref={scrollRef} aria-live="polite">
          {!messages.length ? <div className="codex-assistant-empty"><Bot size={26} /><p>{t("codexAssistant.prompt")}</p></div> : messages.map((message, index) => <div key={`${index}-${message.role}`} className={`codex-assistant-message ${message.role}`}>{message.text || (busy ? <LoaderCircle className="codex-assistant-spinner" size={15} /> : null)}</div>)}
          {activity ? <div className="codex-assistant-activity"><LoaderCircle className="codex-assistant-spinner" size={14} />{activity}</div> : null}
          {error && status?.account ? <div className="codex-assistant-error" role="alert">{error}</div> : null}
        </div>
        {status.account.type === "chatgpt" ? <div className="codex-assistant-plan">{t("codexAssistant.usingPlan")}</div> : null}
        <form className="codex-assistant-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("codexAssistant.placeholder")} aria-label={t("codexAssistant.placeholder")} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          {busy ? <button type="button" className="codex-assistant-send" title={t("codexAssistant.stop")} aria-label={t("codexAssistant.stop")} onClick={() => void cancel()}><Square size={16} fill="currentColor" /></button> : <button type="submit" className="codex-assistant-send" title={t("codexAssistant.send")} aria-label={t("codexAssistant.send")} disabled={!draft.trim()}><Send size={16} /></button>}
        </form>
        <footer className="codex-assistant-footer">{t("codexAssistant.footer")}</footer>
      </>}
    </section> : null}
  </>;
}

function chooseAutomaticModel(models: Model[], text: string) {
  const eligible = models.filter((model) => (model.supportedReasoningEfforts?.length ?? 0) > 0);
  const defaultModel = eligible.find((model) => model.isDefault) ?? eligible[0] ?? models[0];
  const complex = text.length > 240 || /\b(mehrere|komplex|hohl|aushöhlen|boolean|bohrungen|halterung|pattern|multiple|hollow|sweep|fillet|chamfer)\b/i.test(text);
  if (complex && defaultModel?.upgrade) return eligible.find((model) => model.id === defaultModel.upgrade || model.model === defaultModel.upgrade) ?? defaultModel;
  return defaultModel;
}
