"use client";

import { Bot, ChevronDown, ExternalLink, LoaderCircle, Mic, MicOff, Send, Sparkles, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";

type Model = { id: string; model: string; displayName: string; isDefault?: boolean; upgrade?: string | null; supportedReasoningEfforts?: Array<{ reasoningEffort: string }>; defaultReasoningEffort?: string };
type Message = { role: "user" | "assistant"; text: string };
type McpConnection = { reachable: boolean; editorCount: number; editors: Array<{ editorNumber?: number; projectName?: string; focused?: boolean }>; detail: string; baseUrl: string; codexAvailable: boolean };
type Status = { account: { type?: string; email?: string | null; planType?: string } | null; models: Model[]; rateLimits: any; rateLimitsByLimitId: Record<string, any> | null; mcpConnection?: McpConnection };
type Approval = { requestId: number; method: string; nonce: string; params: { message?: string; serverName?: string; reason?: string | null; command?: string[]; _meta?: { codex_approval_kind?: string; persist?: string | string[]; tool_name?: string; toolName?: string }; questions?: Array<{ id: string; header?: string; question: string; options?: Array<{ label: string; description?: string }> | null }> } };
type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null; onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
const THREAD_KEY = "layerling.codexAssistant.thread";
const MESSAGES_KEY = "layerling.codexAssistant.messages";
const CLIENT_KEY = "layerling.codexAssistant.clientId";
const ENABLED_KEY = "layerling.codexAssistant.enabled";
const POSITION_KEY = "layerling.codexAssistant.position";
const PANEL_POSITION_KEY = "layerling.codexAssistant.panelPosition";

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not reach Codex.");
  return result as T;
}

function remaining(window: any) {
  return typeof window?.usedPercent === "number" ? Math.max(0, Math.min(100, 100 - window.usedPercent)) : null;
}

function usageWindowLabel(duration: number | undefined, index: number) {
  if (duration === 300) return t("codexAssistant.usageFiveHours");
  if (duration === 10080) return t("codexAssistant.usageWeekly");
  return duration ? t("codexAssistant.window", { minutes: duration }) : t("codexAssistant.usageWindow", { number: index + 1 });
}

function resetTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "medium" }).format(new Date(timestamp * 1000));
}

function defaultAssistantPositions() {
  const inspector = Array.from(document.querySelectorAll<HTMLElement>(".shape-inspector:not(.floating)"))
    .map((element) => element.getBoundingClientRect())
    .find((rect) => rect.width > 0 && rect.right >= window.innerWidth - 4);
  const rightEdge = Math.max(16, (inspector?.left ?? window.innerWidth) - 12);
  const launcher = { x: Math.max(8, rightEdge - 48 - 16), y: Math.max(8, window.innerHeight - 80) };
  const toolbarHeight = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--editor-toolbar-height")) || 120;
  const panelHeight = Math.min(570, Math.max(300, window.innerHeight - toolbarHeight - 110));
  return {
    launcher,
    panel: {
      x: Math.max(8, rightEdge - 390),
      y: Math.max(8, launcher.y - panelHeight - 28),
    },
  };
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
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [clientId, setClientId] = useState("");
  const [mcpConnection, setMcpConnection] = useState<McpConnection | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState("");
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [connectionDetailsOpen, setConnectionDetailsOpen] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const connection = mcpConnection || status?.mcpConnection;
  const isConnected = Boolean(connection?.reachable && connection.editorCount > 0);
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number; startX: number; startY: number; pointerId: number; moved: boolean } | null>(null);
  const panelDrag = useRef<{ x: number; y: number; originX: number; originY: number; startX: number; startY: number; pointerId: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const modelPopoverRef = useRef<HTMLDivElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const wasDragging = useRef(false);
  const cursor = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    try {
      let sessionId = sessionStorage.getItem(CLIENT_KEY) || "";
      if (!sessionId) {
        sessionId = window.crypto?.randomUUID?.() || `layerling-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        sessionStorage.setItem(CLIENT_KEY, sessionId);
      }
      setClientId(sessionId);
      setThreadId(sessionStorage.getItem(THREAD_KEY) || "");
      setMessages(JSON.parse(sessionStorage.getItem(MESSAGES_KEY) || "[]"));
      setEnabled(localStorage.getItem(ENABLED_KEY) === "true");
      const savedPosition = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
      if (savedPosition && Number.isFinite(savedPosition.x) && Number.isFinite(savedPosition.y)) setPosition(savedPosition);
      else setPosition(defaultAssistantPositions().launcher);
      const savedPanelPosition = JSON.parse(localStorage.getItem(PANEL_POSITION_KEY) || "null");
      setPanelPosition(savedPanelPosition && Number.isFinite(savedPanelPosition.x) && Number.isFinite(savedPanelPosition.y)
        ? savedPanelPosition
        : defaultAssistantPositions().panel);
    } catch { /* Private browsing may block local storage. */ }
    const onPreferenceChange = (event: Event) => setEnabled(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("layerling:codex-assistant-enabled", onPreferenceChange);
    return () => window.removeEventListener("layerling:codex-assistant-enabled", onPreferenceChange);
  }, []);
  useEffect(() => () => speechRecognitionRef.current?.stop(), []);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || modelPopoverRef.current?.contains(target) || modelTriggerRef.current?.contains(target)) return;
      setModelMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); setModelMenuOpen(false); }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [modelMenuOpen]);
  useEffect(() => {
    if (!open) return;
    const keepPanelVisible = () => {
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left));
      const y = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top));
      if (x !== rect.left || y !== rect.top) setPanelPosition({ x, y });
    };
    const frame = window.requestAnimationFrame(keepPanelVisible);
    window.addEventListener("resize", keepPanelVisible);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", keepPanelVisible); };
  }, [open]);
  const onLauncherPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const defaults = defaultAssistantPositions().launcher;
    const x = position.x || defaults.x;
    const y = position.y || defaults.y;
    drag.current = { x, y, originX: x, originY: y, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onLauncherPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const x = Math.max(8, Math.min(window.innerWidth - 56, drag.current.originX + event.clientX - drag.current.startX));
    const y = Math.max(8, Math.min(window.innerHeight - 56, drag.current.originY + event.clientY - drag.current.startY));
    drag.current.moved = drag.current.moved || Math.abs(event.clientX - drag.current.startX) + Math.abs(event.clientY - drag.current.startY) > 4;
    setPosition({ x, y });
    drag.current.x = x;
    drag.current.y = y;
  };
  const onLauncherPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || event.pointerId !== drag.current.pointerId) return;
    const moved = drag.current.moved;
    wasDragging.current = moved;
    if (moved) try { localStorage.setItem(POSITION_KEY, JSON.stringify({ x: drag.current.x, y: drag.current.y })); } catch { /* Position is kept for this visit. */ }
    drag.current = null;
  };
  const onPanelPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest("button, a, input, textarea, select")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    panelDrag.current = { x: rect.left, y: rect.top, originX: rect.left, originY: rect.top, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPanelPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!panelDrag.current || event.pointerId !== panelDrag.current.pointerId) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const maxX = Math.max(8, window.innerWidth - (rect?.width || 390) - 8);
    const maxY = Math.max(8, window.innerHeight - (rect?.height || 570) - 8);
    const x = Math.max(8, Math.min(maxX, panelDrag.current.originX + event.clientX - panelDrag.current.startX));
    const y = Math.max(8, Math.min(maxY, panelDrag.current.originY + event.clientY - panelDrag.current.startY));
    panelDrag.current.x = x;
    panelDrag.current.y = y;
    setPanelPosition({ x, y });
  };
  const onPanelPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!panelDrag.current || event.pointerId !== panelDrag.current.pointerId) return;
    try { localStorage.setItem(PANEL_POSITION_KEY, JSON.stringify({ x: panelDrag.current.x, y: panelDrag.current.y })); } catch { /* Position is kept for this visit. */ }
    panelDrag.current = null;
  };

  useEffect(() => {
    if (!clientId) return;
    try { sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(messages.slice(-80))); } catch { /* Conversation still works this visit. */ }
  }, [clientId, messages]);

  const refreshStatus = useCallback(async () => {
    setError("");
    if (!clientId) return;
    try { setStatus(await callApi<Status>(`/api/codex-assistant?baseUrl=${encodeURIComponent(window.location.origin)}&clientId=${encodeURIComponent(clientId)}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect to Codex."); }
  }, [clientId]);

  useEffect(() => { if (open && isConnected && clientId) void refreshStatus(); }, [open, isConnected, clientId, refreshStatus]);
  useEffect(() => {
    if (!busy && (activity === t("codexAssistant.working") || activity === t("codexAssistant.starting"))) setActivity("");
  }, [activity, busy]);
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
        const result = await callApi<{ events: Array<{ id: number; type: string; text?: string; data?: any }>; latest: number; running: boolean }>(`/api/codex-assistant?action=events&clientId=${encodeURIComponent(clientId)}&since=${cursor.current}`);
        if (!alive) return;
        let turnFinished = false;
        let turnInterrupted = false;
        let authChanged = false;
        for (const event of result.events) {
          cursor.current = Math.max(cursor.current, event.id);
          if (event.type === "delta" && event.text) {
            setMessages((current) => {
              const last = current.at(-1);
              return last?.role === "assistant" ? [...current.slice(0, -1), { ...last, text: last.text + event.text }] : [...current, { role: "assistant", text: event.text! }];
            });
          } else if (event.type === "turnStarted" || event.type === "tool") setActivity(t("codexAssistant.working"));
          else if (event.type === "approval" && event.data && typeof event.data === "object") setApproval(event.data as Approval);
          else if (event.type === "turn") {
            const turn = event.data as { status?: string; error?: { message?: string } } | undefined;
            turnFinished = true;
            setActivity("");
            if (turn?.status === "failed") setError(turn.error?.message || t("codexAssistant.failed"));
            if (turn?.status === "interrupted") { turnInterrupted = true; setActivity(t("codexAssistant.stopped")); }
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
            setApproval(null);
            setActivity("");
            setError(t("codexAssistant.failed"));
          }
        }
        if (authChanged) void refreshStatus();
        if (result.running || loginPending || (busy && activity === t("codexAssistant.starting"))) window.setTimeout(poll, 650);
        else if (busy && (turnFinished || !result.running)) { setBusy(false); if (!turnInterrupted) setActivity(""); void refreshStatus(); }
      } catch (cause) {
        if (alive) { setBusy(false); setActivity(""); setError(cause instanceof Error ? cause.message : t("codexAssistant.failed")); }
      }
    };
    void poll();
    return () => { alive = false; };
  }, [busy, clientId, loginPending, open, activity, refreshStatus]);

  const refreshMcpStatus = useCallback(async () => {
    try {
      const connection = await callApi<McpConnection>(`/api/codex-assistant?action=mcp-status&baseUrl=${encodeURIComponent(window.location.origin)}`);
      setMcpConnection(connection);
    } catch (cause) {
      const connection = { reachable: false, editorCount: 0, editors: [], detail: cause instanceof Error ? cause.message : "MCP-Status nicht verfügbar.", baseUrl: window.location.origin, codexAvailable: false };
      setMcpConnection(connection);
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refreshMcpStatus();
    const timer = window.setInterval(() => void refreshMcpStatus(), 6000);
    return () => window.clearInterval(timer);
  }, [enabled, refreshMcpStatus]);

  const startLogin = async () => {
    setError("");
    try {
      const result = await callApi<{ authUrl?: string }>("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", clientId, baseUrl: window.location.origin }) });
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
    const chosenEffort = availableEfforts.includes(effort) ? effort : (modelId === "auto" && availableEfforts.includes(autoEffort) ? autoEffort : model.defaultReasoningEffort || availableEfforts[0] || "medium");
    setError(""); setActivity(t("codexAssistant.starting")); setBusy(true); setDraft("");
    setMessages((current) => [...current, { role: "user", text }, { role: "assistant", text: "" }]);
    try {
      const result = await callApi<{ threadId: string }>("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", clientId, text, threadId: threadId || null, model: model.id || model.model, effort: chosenEffort, baseUrl: window.location.origin }) });
      setThreadId(result.threadId);
      try { sessionStorage.setItem(THREAD_KEY, result.threadId); } catch { /* In-memory continuation remains available. */ }
      setActivity(t("codexAssistant.working"));
    } catch (cause) {
      setBusy(false); setActivity(""); setMessages((current) => current.at(-1)?.role === "assistant" ? current.slice(0, -1) : current);
      const message = cause instanceof Error ? cause.message : t("codexAssistant.failed");
      const mcpToolsPrefix = "LAYERLING_MCP_TOOLS_UNAVAILABLE:";
      setError(message.startsWith(mcpToolsPrefix)
        ? t("codexAssistant.mcpToolsUnavailable", { tools: message.slice(mcpToolsPrefix.length) })
        : message);
    }
  };

  const cancel = async () => {
    try { await callApi("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", clientId }) }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("codexAssistant.failed")); }
  };

  const answerApproval = async (requestId: number, method: string, nonce: string, questionId: string, answer: string, persistentScope?: "tool" | "all") => {
    setApprovalBusy(true);
    setApprovalError("");
    try {
      await callApi("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "approval", clientId, requestId, method, nonce, questionId, answer, persistentScope }) });
      setApproval(null);
    } catch (cause) { setApprovalError(cause instanceof Error ? cause.message : t("codexAssistant.failed")); }
    finally { setApprovalBusy(false); }
  };

  const logout = async () => {
    setLogoutBusy(true);
    try {
      await callApi("/api/codex-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout", clientId, baseUrl: window.location.origin }) });
      setConnectionDetailsOpen(false);
      await refreshStatus();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("codexAssistant.failed")); }
    finally { setLogoutBusy(false); }
  };

  const toggleVoiceInput = () => {
    if (speechRecognitionRef.current) {
      speechRecognitionRef.current.stop();
      return;
    }
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError(t("codexAssistant.voiceUnsupported")); return; }
    setError("");
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || "de-DE";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length - event.resultIndex }, (_, index) => event.results[event.resultIndex + index])
        .filter((result) => result?.isFinal !== false)
        .map((result) => result?.[0]?.transcript || "")
        .join(" ").trim();
      if (transcript) setDraft((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${transcript}`);
    };
    recognition.onerror = (event) => setError(event.error === "not-allowed" || event.error === "service-not-allowed" ? t("codexAssistant.voicePermissionDenied") : t("codexAssistant.voiceFailed"));
    recognition.onend = () => { speechRecognitionRef.current = null; setVoiceListening(false); };
    speechRecognitionRef.current = recognition;
    setVoiceListening(true);
    try { recognition.start(); }
    catch { speechRecognitionRef.current = null; setVoiceListening(false); setError(t("codexAssistant.voiceFailed")); }
  };

  const quota = status?.rateLimitsByLimitId?.codex ?? status?.rateLimits;
  const windows = [quota?.primary, quota?.secondary].filter(Boolean);
  const selectedModel = modelId === "auto"
    ? chooseAutomaticModel(status?.models ?? [], draft)
    : status?.models.find((item) => item.id === modelId || item.model === modelId) ?? status?.models.find((item) => item.isDefault) ?? status?.models[0];
  const availableEfforts = selectedModel?.supportedReasoningEfforts?.map((item) => item.reasoningEffort) ?? ["low", "medium", "high"];
  const effortOptions = ["low", "medium", "high", "xhigh"].filter((value) => availableEfforts.includes(value));
  const sliderEfforts = effortOptions.length ? effortOptions : availableEfforts.includes("minimal") ? ["minimal"] : ["low", "medium", "high"];
  const selectedEffort = sliderEfforts.includes(effort) ? effort : sliderEfforts[0];
  const selectedEffortIndex = Math.max(0, sliderEfforts.indexOf(selectedEffort));
  const effortLabel = (value: string) => value === "xhigh" ? t("codexAssistant.effortVeryHigh") : value === "high" ? t("codexAssistant.effortHigh") : value === "low" || value === "minimal" ? t("codexAssistant.effortLow") : t("codexAssistant.effortMedium");
  const currentModelLabel = modelId === "auto" ? t("codexAssistant.automatic") : selectedModel?.displayName || selectedModel?.id || t("codexAssistant.model");
  const supportsPersistentApproval = approval?.method === "mcpServer/elicitation/request" && approval.params.serverName === "layerling" && approval.params._meta?.codex_approval_kind === "mcp_tool_call" && (approval.params._meta.persist === "always" || (Array.isArray(approval.params._meta.persist) && approval.params._meta.persist.includes("always")));
  const approvalToolName = approval?.params._meta?.tool_name || approval?.params._meta?.toolName || approval?.params.message?.match(/tool\s+[\"']([^\"']+)[\"']/i)?.[1];
  if (!enabled || !isConnected || !connection?.codexAvailable) return null;
  const defaultPositions = typeof window !== "undefined" ? defaultAssistantPositions() : { launcher: { x: 0, y: 0 }, panel: { x: 0, y: 0 } };
  const launcherX = position.x || defaultPositions.launcher.x;
  const launcherY = position.y || defaultPositions.launcher.y;
  return <>
    <button className="codex-assistant-launcher" type="button" style={{ left: launcherX, top: launcherY }} aria-label={t("codexAssistant.open")} title={t("codexAssistant.open")} aria-expanded={open} onPointerDown={onLauncherPointerDown} onPointerMove={onLauncherPointerMove} onPointerUp={onLauncherPointerUp} onClick={() => { if (wasDragging.current) { wasDragging.current = false; return; } setOpen((value) => !value); }}>
      <Sparkles size={20} aria-hidden="true" />
    </button>
    {open ? <section ref={panelRef} className="codex-assistant-panel" style={{ left: panelPosition.x, top: panelPosition.y }} role="dialog" aria-label={t("codexAssistant.title")}>
      <header className="codex-assistant-header" onPointerDown={onPanelPointerDown} onPointerMove={onPanelPointerMove} onPointerUp={onPanelPointerUp}>
        <div className="codex-assistant-heading"><Bot size={19} aria-hidden="true" /><div><strong>{t("codexAssistant.title")}</strong><small>{status?.account?.type === "chatgpt" ? t("codexAssistant.connected") : t("codexAssistant.localCodex")}</small></div><button type="button" className="codex-assistant-connection" data-connected={isConnected} title={connection?.detail || t("codexAssistant.connectionChecking")} aria-label={t("codexAssistant.connectionStatus", { status: connection?.detail || t("codexAssistant.connectionChecking") })} aria-expanded={connectionDetailsOpen} onClick={() => setConnectionDetailsOpen((value) => !value)}><span className="codex-assistant-connection-dot" /></button></div>
        <div className="codex-assistant-header-actions">
          {windows.length ? <button type="button" className="codex-assistant-quota-trigger" onClick={() => setQuotaOpen((value) => !value)} aria-expanded={quotaOpen} title={t("codexAssistant.usage")}>{windows.map((item: any, index: number) => <span key={index}>{remaining(item) === null ? "—" : `${remaining(item)}%`}</span>)}</button> : null}
          <button type="button" className="codex-assistant-icon-button" title={t("codexAssistant.close")} aria-label={t("codexAssistant.close")} onClick={() => { setModelMenuOpen(false); setOpen(false); }}><X size={17} /></button>
        </div>
      </header>
      {connectionDetailsOpen ? <div className="codex-assistant-connection-details"><strong>{isConnected ? t("codexAssistant.connectionAvailable") : t("codexAssistant.connectionUnavailable")}</strong><span>{connection?.detail || t("codexAssistant.connectionChecking")}</span><small>{connection?.baseUrl || window.location.origin}</small>{connection?.editors.map((editor) => <small key={editor.editorNumber}>{t("codexAssistant.editorDetail", { number: editor.editorNumber ?? "—", project: editor.projectName || t("codexAssistant.unnamedDesign") })}</small>)}{status?.account ? <button type="button" onClick={() => void logout()} disabled={logoutBusy}>{logoutBusy ? t("codexAssistant.signingOut") : t("codexAssistant.signOut")}</button> : null}</div> : null}
      {quotaOpen ? <div className="codex-assistant-quota">
        {windows.map((item: any, index: number) => {
          const left = remaining(item);
          const resets = typeof item.resetsAt === "number" ? resetTime(item.resetsAt) : null;
          const tooltip = resets ? t("codexAssistant.resets", { time: resets }) : t("codexAssistant.resetUnavailable");
          return <div key={index} className="codex-assistant-quota-row">
            <div className="codex-assistant-quota-heading"><span>{usageWindowLabel(item.windowDurationMins, index)}</span><strong>{left === null ? "—" : `${left}%`}</strong></div>
            <div className="codex-assistant-quota-bar" title={tooltip} role="progressbar" aria-label={usageWindowLabel(item.windowDurationMins, index)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={left ?? 0}><span style={{ width: `${left ?? 0}%` }} /></div>
            <small>{resets ? t("codexAssistant.resets", { time: resets }) : t("codexAssistant.resetUnavailable")}</small>
          </div>;
        })}
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">{t("codexAssistant.manageUsage")} <ExternalLink size={12} /></a>
      </div> : null}
      {!status?.account ? <div className="codex-assistant-setup">
        <p>{error || t("codexAssistant.connectDescription")}</p>
        <button type="button" className="codex-assistant-primary" onClick={() => void startLogin()}>{t("codexAssistant.connect")}</button>
        <p className="codex-assistant-footnote">{t("codexAssistant.localOnly")}</p>
      </div> : <>
        <div className="codex-assistant-messages" ref={scrollRef} aria-live="polite">
          {!messages.length ? <div className="codex-assistant-empty"><Bot size={26} /><p>{t("codexAssistant.prompt")}</p></div> : messages.map((message, index) => <div key={`${index}-${message.role}`} className={`codex-assistant-message ${message.role}`}>{message.text || (busy ? <LoaderCircle className="codex-assistant-spinner" size={15} /> : null)}</div>)}
          {activity ? <div className="codex-assistant-activity"><LoaderCircle className="codex-assistant-spinner" size={14} />{activity}</div> : null}
          {error && status?.account ? <div className="codex-assistant-error" role="alert">{error}</div> : null}
        </div>
        {approval ? <div className="codex-assistant-approval-dock">{approvalError ? <p className="codex-assistant-approval-error" role="alert">{approvalError}</p> : null}<div className="codex-assistant-approval"><strong>{t("codexAssistant.approvalTitle")}</strong>{approval.params.questions?.length ? approval.params.questions.map((question) => <div key={question.id}><p>{question.question}</p><div>{(question.options || []).map((option) => <button key={option.label} type="button" disabled={approvalBusy} title={option.description} onClick={() => void answerApproval(approval.requestId, approval.method, approval.nonce, question.id, option.label)}>{option.label}</button>)}</div></div>) : <div><p>{approval.params.message || approval.params.reason || approval.params.command?.join(" ") || t("codexAssistant.approvalFallback")}</p><div className="codex-assistant-approval-actions"><button type="button" disabled={approvalBusy} onClick={() => void answerApproval(approval.requestId, approval.method, approval.nonce, "", "accept")}>{t("codexAssistant.approve")}</button>{supportsPersistentApproval && approvalToolName ? <button type="button" disabled={approvalBusy} title={t("codexAssistant.approvalAlwaysToolHelp")} onClick={() => void answerApproval(approval.requestId, approval.method, approval.nonce, "", "accept", "tool")}>{t("codexAssistant.approvalAlwaysTool")}</button> : null}{supportsPersistentApproval ? <button type="button" disabled={approvalBusy} title={t("codexAssistant.approvalAlwaysAllHelp")} onClick={() => void answerApproval(approval.requestId, approval.method, approval.nonce, "", "accept", "all")}>{t("codexAssistant.approvalAlwaysAll")}</button> : null}<button type="button" disabled={approvalBusy} onClick={() => void answerApproval(approval.requestId, approval.method, approval.nonce, "", "decline")}>{t("codexAssistant.decline")}</button></div></div>}</div></div> : null}
        {status.account.type === "chatgpt" ? <div className="codex-assistant-plan">{t("codexAssistant.usingPlan")}</div> : null}
        {modelMenuOpen ? <div ref={modelPopoverRef} className="codex-assistant-model-popover" role="dialog" aria-label={t("codexAssistant.modelAndEffort")}>
          <div className="codex-assistant-model-popover-heading"><span>{effortLabel(selectedEffort)}</span><small>{selectedModel?.displayName || selectedModel?.id || ""}</small></div>
          <label className="codex-assistant-popover-model"><span>{t("codexAssistant.model")}</span><select value={modelId} onChange={(event) => { setModelId(event.target.value); const next = event.target.value === "auto" ? chooseAutomaticModel(status.models, draft) : status.models.find((item) => item.id === event.target.value); const supported = next?.supportedReasoningEfforts?.map((item) => item.reasoningEffort) ?? []; if (!supported.includes(effort)) setEffort(next?.defaultReasoningEffort || supported.find((value) => ["low", "medium", "high", "xhigh"].includes(value)) || "medium"); }}>
            <option value="auto">{t("codexAssistant.automatic")}</option>
            {status.models.map((model) => <option key={model.id} value={model.id}>{model.displayName || model.id}</option>)}
          </select></label>
          <label className="codex-assistant-effort-slider"><span>{t("codexAssistant.reasoning")}</span><input type="range" min={0} max={Math.max(0, sliderEfforts.length - 1)} step={1} value={selectedEffortIndex} disabled={sliderEfforts.length < 2} aria-valuetext={effortLabel(sliderEfforts[selectedEffortIndex])} onChange={(event) => setEffort(sliderEfforts[Number(event.target.value)] || effort)} /><span className="codex-assistant-effort-labels">{sliderEfforts.map((value, index) => <span key={value} className={index === selectedEffortIndex ? "selected" : ""}>{effortLabel(value)}</span>)}</span></label>
        </div> : null}
        <form className="codex-assistant-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="codex-assistant-composer-field">
            <button ref={modelTriggerRef} type="button" className="codex-assistant-model-trigger" aria-label={t("codexAssistant.modelAndEffort")} aria-expanded={modelMenuOpen} onClick={() => setModelMenuOpen((value) => !value)}><span>{currentModelLabel}</span><span>{effortLabel(selectedEffort)}</span><ChevronDown size={13} /></button>
            <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={t("codexAssistant.placeholder")} aria-label={t("codexAssistant.placeholder")} rows={2} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
          </div>
          <button type="button" className={`codex-assistant-voice${voiceListening ? " is-listening" : ""}`} title={voiceListening ? t("codexAssistant.stopVoiceInput") : t("codexAssistant.startVoiceInput")} aria-label={voiceListening ? t("codexAssistant.stopVoiceInput") : t("codexAssistant.startVoiceInput")} aria-pressed={voiceListening} onClick={toggleVoiceInput} disabled={busy}>{voiceListening ? <MicOff size={16} /> : <Mic size={16} />}</button>
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
