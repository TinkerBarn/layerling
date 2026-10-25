import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { approvalMatches } from "./codexAssistantApproval";
import { missingRequiredLayerlingTools } from "./layerlingMcpFeatureDetection";

type RpcMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: any; error?: { message?: string } };
type AssistantEvent = { id: number; type: string; text?: string; data?: unknown };
type Conversation = { events: AssistantEvent[]; eventId: number; threadId: string | null; turnId: string | null; touchedAt: number };

async function resolveCodexExecutable() {
  const command = process.env.CODEX_EXECUTABLE?.trim() || "codex";
  const windows = process.platform === "win32";
  const commandHasPath = isAbsolute(command) || command.includes("/") || command.includes("\\");
  const extensions = windows
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  const names = /\.[a-z0-9]+$/i.test(command) ? [command] : extensions.map((extension) => `${command}${extension}`);
  const directories = commandHasPath ? [""] : (process.env.PATH || "").split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const name of names) {
      const candidate = directory ? join(directory, name) : name;
      try {
        await access(candidate, windows ? fsConstants.F_OK : fsConstants.X_OK);
        return candidate;
      } catch { /* Keep looking through PATH. */ }
    }
  }
  return null;
}

class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private stderr = "";
  private baseUrl = "http://127.0.0.1:3000";
  private processConfigVersion = 3;
  private starting: Promise<void> | null = null;

  private get pendingApprovals() {
    const server = this as CodexAppServer & { __pendingApprovals?: Map<number, Record<string, any>> };
    return server.__pendingApprovals ??= new Map<number, Record<string, any>>();
  }

  private get conversations() {
    const server = this as CodexAppServer & { __conversations?: Map<string, Conversation> };
    return server.__conversations ??= new Map<string, Conversation>();
  }

  private get threadOwners() {
    const server = this as CodexAppServer & { __threadOwners?: Map<string, string> };
    return server.__threadOwners ??= new Map<string, string>();
  }

  private conversation(clientId: string) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(clientId)) throw new Error("A valid assistant session ID is required.");
    let session = this.conversations.get(clientId);
    if (!session) {
      if (this.conversations.size >= 64) {
        const stale = [...this.conversations.entries()].filter(([, item]) => !item.turnId).sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
        if (stale) { this.conversations.delete(stale[0]); if (stale[1].threadId) this.threadOwners.delete(stale[1].threadId); }
        else throw new Error("Too many active Layerling assistant sessions. Close an active chat and try again.");
      }
      session = { events: [], eventId: 0, threadId: null, turnId: null, touchedAt: Date.now() };
      this.conversations.set(clientId, session);
    }
    session.touchedAt = Date.now();
    return session;
  }

  private emit(clientId: string, type: string, data?: unknown, text?: string) {
    const session = this.conversation(clientId);
    session.events.push({ id: ++session.eventId, type, text, data });
    if (session.events.length > 500) session.events.splice(0, session.events.length - 500);
  }

  private emitForThread(threadId: unknown, type: string, data?: unknown, text?: string) {
    if (typeof threadId !== "string") return;
    const clientId = this.threadOwners.get(threadId);
    if (clientId) this.emit(clientId, type, data, text);
  }

  private broadcast(type: string, data?: unknown) {
    for (const clientId of this.conversations.keys()) this.emit(clientId, type, data);
  }

  private async start() {
    if (this.starting) return this.starting;
    if (this.child && this.child.exitCode === null) return;
    const attempt = this.startInternal();
    this.starting = attempt;
    try {
      await attempt;
    } catch (error) {
      this.child?.kill();
      this.child = null;
      this.failPending(error instanceof Error ? error : new Error("Codex app-server could not start."));
      this.pendingApprovals.clear();
      throw error;
    } finally {
      if (this.starting === attempt) this.starting = null;
    }
  }

  private async startInternal() {
    if (this.child && this.child.exitCode === null) return;
    const executable = await resolveCodexExecutable();
    if (!executable) throw new Error("Codex CLI was not found. Install Codex CLI, make it available in PATH, or set CODEX_EXECUTABLE to its path.");
    this.child = spawn(executable, [
      "app-server", "--listen", "stdio://",
      "-c", "mcp_servers={}",
      "-c", 'mcp_servers.layerling.command="node"',
      "-c", 'mcp_servers.layerling.args=["scripts/layerling-mcp-server.mjs"]',
      "-c", `mcp_servers.layerling.env={LAYERLING_URL=${JSON.stringify(this.baseUrl)},LAYERLING_MCP_OPEN_EDITOR="0",LAYERLING_MCP_ASSISTANT_MODE="1"}`,
      "-c", "mcp_servers.layerling.enabled=true",
    ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, LAYERLING_URL: this.baseUrl, LAYERLING_MCP_OPEN_EDITOR: "0", LAYERLING_MCP_ASSISTANT_MODE: "1" }, shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(executable) });
    this.processConfigVersion = 3;
    const child = this.child;
    this.stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.stderr = `${this.stderr}${chunk}`.slice(-3000); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: RpcMessage;
      try { message = JSON.parse(line) as RpcMessage; } catch { return; }
      if (typeof message.id === "number" && message.method) {
        const threadId = message.params?.threadId;
        const clientId = typeof threadId === "string" ? this.threadOwners.get(threadId) : undefined;
        const nonce = randomUUID();
        this.pendingApprovals.set(message.id, { ...(message.params || {}), __layerlingClientId: clientId, __layerlingMethod: message.method, __layerlingNonce: nonce });
        if (clientId) this.emit(clientId, "approval", { requestId: message.id, method: message.method, params: message.params, nonce });
        return;
      }
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const request = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || "Codex app-server request failed."));
        else request.resolve(message.result);
        return;
      }
      if (message.method === "item/agentMessage/delta") {
        const delta = typeof message.params?.delta === "string" ? message.params.delta : "";
        if (delta) this.emitForThread(message.params?.threadId, "delta", undefined, delta);
      } else if (message.method === "turn/completed") {
        const turn = message.params?.turn as Record<string, unknown> | undefined;
        const threadId = message.params?.threadId;
        this.emitForThread(threadId, "turn", turn);
        if (typeof threadId === "string") {
          const clientId = this.threadOwners.get(threadId);
          if (clientId) { const session = this.conversations.get(clientId); if (session) session.turnId = null; }
        }
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = message.params?.item as Record<string, unknown> | undefined;
        if (item?.type === "mcpToolCall") this.emitForThread(message.params?.threadId, "tool", item);
      } else if (message.method === "account/login/completed" || message.method === "account/updated" || message.method === "mcpServer/startupStatus/updated") {
        this.broadcast("status", { method: message.method, params: message.params });
      }
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.pendingApprovals.clear();
      const processError = error as NodeJS.ErrnoException;
      this.failPending(processError.code === "ENOENT"
        ? new Error("Codex CLI was not found. Install Codex CLI or set CODEX_EXECUTABLE to its path.")
        : error);
    });
    child.on("exit", (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.pendingApprovals.clear();
      this.failPending(new Error(code === 0 ? "Codex app-server stopped." : this.friendlyProcessError()));
      for (const session of this.conversations.values()) session.turnId = null;
      this.broadcast("process", { code });
    });
    await this.rpc("initialize", {
      clientInfo: { name: "layerling", title: "Layerling", version: "1.111.0" },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
  }

  private async useBaseUrl(baseUrl?: string) {
    const validBaseUrl = baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl);
    const urlChanged = Boolean(validBaseUrl && baseUrl !== this.baseUrl);
    const processOutdated = this.processConfigVersion !== 3;
    if (!urlChanged && !processOutdated) return;
    if (validBaseUrl) this.baseUrl = baseUrl;
    const child = this.child;
    if (!child || child.exitCode !== null) { this.processConfigVersion = 3; return; }
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "exit", params: {} })}\n`); } catch { /* Force-stop below if needed. */ }
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) child.kill();
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
    if (child.exitCode === null) throw new Error("Codex is still switching the Layerling connection. Please try again in a moment.");
    this.processConfigVersion = 3;
  }

  private friendlyProcessError() {
    if (/sqlite state runtime|permission denied|operation not permitted/i.test(this.stderr)) return "Codex could not open its local account data. Check that the Codex app has access to its own settings folder.";
    if (/not found|enoent/i.test(this.stderr)) return "Codex CLI was not found. Install Codex CLI or set CODEX_EXECUTABLE to its path.";
    return this.stderr.trim() || "Codex app-server stopped unexpectedly.";
  }

  private failPending(error: Error) {
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }

  private notify(method: string, params: Record<string, unknown>) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  private rpc(method: string, params: Record<string, unknown> = {}, timeoutMs = 30000) {
    if (!this.child || this.child.exitCode !== null) return Promise.reject(new Error("Codex app-server is not running."));
    const id = this.nextId++;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("Codex did not respond in time.")); }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async status(baseUrl?: string, clientId = "default-session") {
    this.conversation(clientId);
    const mcpConnection = await this.readMcpConnection(this.validatedBaseUrl(baseUrl));
    if (!mcpConnection.reachable || !mcpConnection.editorCount) throw new Error("Open a Layerling editor to use the assistant.");
    await this.useBaseUrl(baseUrl);
    await this.start();
    const [auth, models, quota] = await Promise.all([
      this.rpc("account/read", { refreshToken: false }),
      this.rpc("model/list", { limit: 100, includeHidden: false }).catch(() => null),
      this.rpc("account/rateLimits/read", {}).catch(() => null),
    ]);
    return {
      account: auth?.account ?? null,
      requiresOpenaiAuth: auth?.requiresOpenaiAuth ?? true,
      models: models?.data ?? [],
      rateLimits: quota?.rateLimits ?? null,
      rateLimitsByLimitId: quota?.rateLimitsByLimitId ?? null,
      mcpConnection,
    };
  }

  private validatedBaseUrl(baseUrl?: string) {
    return baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(baseUrl) ? baseUrl : this.baseUrl;
  }

  private async readMcpConnection(baseUrl = this.baseUrl) {
    try {
      const response = await fetch(new URL("/api/layerling-mcp", baseUrl), { signal: AbortSignal.timeout(3500) });
      if (!response.ok) return { reachable: false, editorCount: 0, editors: [], detail: `Layerling antwortet mit HTTP ${response.status}.`, baseUrl };
      const result = await response.json() as { editors?: Array<{ editorNumber?: number; projectName?: string; focused?: boolean }> };
      const editors = Array.isArray(result.editors) ? result.editors : [];
      return {
        reachable: true,
        editorCount: editors.length,
        editors,
        detail: editors.length ? `${editors.length} Layerling-Editor${editors.length === 1 ? "" : "en"} verbunden.` : "Layerling ist erreichbar, aber kein Editor ist verbunden.",
        baseUrl,
      };
    } catch (error) {
      return { reachable: false, editorCount: 0, editors: [], detail: error instanceof Error ? error.message : "Layerling ist nicht erreichbar.", baseUrl };
    }
  }

  async mcpStatus(baseUrl?: string) {
    const [connection, executable] = await Promise.all([
      this.readMcpConnection(this.validatedBaseUrl(baseUrl)),
      resolveCodexExecutable(),
    ]);
    return { ...connection, codexAvailable: Boolean(executable) };
  }

  async login(clientId: string, baseUrl?: string) {
    this.conversation(clientId);
    const mcpConnection = await this.readMcpConnection(this.validatedBaseUrl(baseUrl));
    if (!mcpConnection.reachable || !mcpConnection.editorCount) throw new Error("Open a Layerling editor to use the assistant.");
    await this.useBaseUrl(baseUrl);
    await this.start();
    return this.rpc("account/login/start", { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" });
  }

  async logout(clientId: string, baseUrl?: string) {
    this.conversation(clientId);
    const mcpConnection = await this.readMcpConnection(this.validatedBaseUrl(baseUrl));
    if (!mcpConnection.reachable || !mcpConnection.editorCount) throw new Error("Open a Layerling editor to use the assistant.");
    await this.useBaseUrl(baseUrl);
    await this.start();
    await this.rpc("account/logout", {});
  }

  async answerApproval(clientId: string, requestId: number, method: string, nonce: string, questionId: string, answer: string, persistentScope?: "tool" | "all") {
    this.conversation(clientId);
    if (!Number.isSafeInteger(requestId) || !/^[0-9a-f-]{36}$/i.test(nonce) || !answer) throw new Error("Die Freigabeantwort ist unvollständig.");
    const pending = this.pendingApprovals.get(requestId);
    if (!approvalMatches(pending, clientId, method, nonce)) throw new Error("Diese Freigabe gehört nicht zu diesem Layerling-Chat oder ist nicht mehr aktuell.");
    if (persistentScope) {
      const params = pending;
      const meta = params?._meta as Record<string, any> | undefined;
      const advertised = meta?.persist;
      const alwaysSupported = advertised === "always" || (Array.isArray(advertised) && advertised.includes("always"));
      if (method !== "mcpServer/elicitation/request" || params?.serverName !== "layerling" || meta?.codex_approval_kind !== "mcp_tool_call" || !alwaysSupported) {
        throw new Error("Diese Anfrage unterstützt keine dauerhafte Layerling-Freigabe.");
      }
      let keyPath: string;
      if (persistentScope === "all") {
        keyPath = "mcp_servers.layerling.default_tools_approval_mode";
      } else {
        const namedTool = typeof meta.tool_name === "string" ? meta.tool_name : typeof meta.toolName === "string" ? meta.toolName : undefined;
        const toolName = namedTool || String(params.message || "").match(/tool\s+[\"']([^\"']+)[\"']/i)?.[1];
        if (!toolName || !/^[a-zA-Z0-9_-]+$/.test(toolName)) throw new Error("Der Werkzeugname konnte nicht sicher ermittelt werden.");
        keyPath = `mcp_servers.layerling.tools.${toolName}.approval_mode`;
      }
      await this.rpc("config/batchWrite", {
        edits: [{ keyPath, value: "approve", mergeStrategy: "upsert" }],
        reloadUserConfig: true,
      });
    }
    let result: Record<string, unknown>;
    if (method === "item/tool/requestUserInput") {
      if (!questionId) throw new Error("Die Freigabeantwort ist unvollständig.");
      result = { answers: { [questionId]: { answers: [answer] } } };
    } else if (method === "mcpServer/elicitation/request") {
      result = { action: answer === "accept" ? "accept" : "decline", content: answer === "accept" ? {} : null, _meta: null };
    } else if (method === "execCommandApproval" || method === "applyPatchApproval") {
      result = { decision: answer === "accept" ? "approved" : { denied: { rejection: "Declined by user" } } };
    } else {
      result = { decision: answer };
    }
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestId, result })}\n`);
    this.pendingApprovals.delete(requestId);
  }

  async send(text: string, threadId: string | null, model: string, effort: string, baseUrl: string | undefined, clientId: string) {
    if (!text.trim()) throw new Error("Enter a message first.");
    const session = this.conversation(clientId);
    const mcpConnection = await this.readMcpConnection(this.validatedBaseUrl(baseUrl));
    if (!mcpConnection.reachable || !mcpConnection.editorCount) throw new Error("Open a Layerling editor to use the assistant.");
    if (threadId) {
      const owner = this.threadOwners.get(threadId);
      if (owner && owner !== clientId) throw new Error("This conversation belongs to a different Layerling chat session.");
    }
    await this.useBaseUrl(baseUrl);
    await this.start();
    const thread = threadId
      ? await this.rpc("thread/resume", { threadId, excludeTurns: true })
      : await this.rpc("thread/start", { model, cwd: process.cwd(), approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "read-only", serviceName: "layerling" });
    const currentThreadId = thread.thread?.id;
    if (!currentThreadId) throw new Error("Codex could not open the conversation.");
    const mcpStatus = await this.rpc("mcpServerStatus/list", { serverName: "layerling", threadId: currentThreadId, detail: "toolsAndAuthOnly", limit: 100 });
    const missingTools = missingRequiredLayerlingTools(mcpStatus);
    if (missingTools.length) {
      throw new Error(`LAYERLING_MCP_TOOLS_UNAVAILABLE:${missingTools.join(", ")}`);
    }
    if (session.threadId && session.threadId !== currentThreadId) this.threadOwners.delete(session.threadId);
    session.threadId = currentThreadId;
    this.threadOwners.set(currentThreadId, clientId);
    const prompt = `You are Layerling's CAD assistant. Use the layerling MCP tools to inspect and change the currently open design. Do not open or launch another Layerling editor or browser window. If no editor is connected, tell the user to open one and retry. Read only the scene context needed for the request. Make requested changes in the editor, preserve existing design where possible, and verify CAD changes by reading the scene again. For simple property changes such as colour, name, or dimensions, use the fewest tool calls needed: read the scene once, update the exact target, then verify once; do not capture an image unless the geometry or placement changed. If the target is one part inside a group, change that part's child object, not the parent group's property. Preserve other parts' colours and the group's multicolour setting unless the user explicitly asks to change them. Never delete objects, clear history, or remove attachments unless the user explicitly asks. Whenever a detail needed for a requested change is unclear or has more than one reasonable interpretation, ask the user before making that affected change; do not guess dimensions, materials, geometry, or placement. When useful, offer a short numbered list of concrete options and ask the user to choose. Do not stall clearly specified, independent parts of the request: make those changes first, then ask about the unresolved part. Only say a change was made after a Layerling tool confirms success. Explain assumptions and report what you changed.\n\nUser request: ${text.trim()}`;
    const result = await this.rpc("turn/start", {
      threadId: currentThreadId,
      input: [{ type: "text", text: prompt }],
      model,
      effort,
      cwd: process.cwd(),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "readOnly" },
    });
    session.turnId = result?.turn?.id ?? null;
    this.emit(clientId, "turnStarted", { threadId: currentThreadId, turnId: session.turnId });
    return { threadId: currentThreadId, turnId: session.turnId };
  }

  async cancel(clientId: string) {
    const session = this.conversation(clientId);
    if (!session.threadId || !session.turnId) return;
    await this.rpc("turn/interrupt", { threadId: session.threadId, turnId: session.turnId });
  }

  readEvents(clientId: string, after: number) {
    const session = this.conversation(clientId);
    return { events: session.events.filter((event) => event.id > after), latest: session.eventId, running: Boolean(session.turnId) };
  }
}

const globalWithCodex = globalThis as typeof globalThis & { __layerlingCodexServer?: CodexAppServer; __layerlingCodexServerVersion?: number };
if (!globalWithCodex.__layerlingCodexServer) globalWithCodex.__layerlingCodexServer = new CodexAppServer();
else if (globalWithCodex.__layerlingCodexServerVersion !== 11) Object.setPrototypeOf(globalWithCodex.__layerlingCodexServer, CodexAppServer.prototype);
globalWithCodex.__layerlingCodexServerVersion = 11;
export const codexAssistantServer = globalWithCodex.__layerlingCodexServer;
