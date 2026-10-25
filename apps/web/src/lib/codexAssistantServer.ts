import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

type RpcMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: any; error?: { message?: string } };
type AssistantEvent = { id: number; type: string; text?: string; data?: unknown };

class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private events: AssistantEvent[] = [];
  private eventId = 0;
  private turnId: string | null = null;
  private threadId: string | null = null;
  private stderr = "";

  private emit(type: string, data?: unknown, text?: string) {
    this.events.push({ id: ++this.eventId, type, text, data });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  private async start() {
    if (this.child && this.child.exitCode === null) return;
    const executable = process.env.CODEX_EXECUTABLE || "codex";
    this.child = spawn(executable, [
      "app-server", "--listen", "stdio://",
      "-c", "mcp_servers={}",
      "-c", 'mcp_servers.layerling.command="node"',
      "-c", 'mcp_servers.layerling.args=["scripts/layerling-mcp-server.mjs"]',
      "-c", "mcp_servers.layerling.enabled=true",
    ], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    const child = this.child;
    this.stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { this.stderr = `${this.stderr}${chunk}`.slice(-3000); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: RpcMessage;
      try { message = JSON.parse(line) as RpcMessage; } catch { return; }
      if (typeof message.id === "number" && this.pending.has(message.id)) {
        const request = this.pending.get(message.id)!;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || "Codex app-server request failed."));
        else request.resolve(message.result);
        return;
      }
      if (message.method === "item/agentMessage/delta") {
        const delta = typeof message.params?.delta === "string" ? message.params.delta : "";
        if (delta) this.emit("delta", undefined, delta);
      } else if (message.method === "turn/completed") {
        const turn = message.params?.turn as Record<string, unknown> | undefined;
        this.emit("turn", turn);
        this.turnId = null;
      } else if (message.method === "item/started" || message.method === "item/completed") {
        const item = message.params?.item as Record<string, unknown> | undefined;
        if (item?.type === "mcpToolCall") this.emit("tool", item);
      } else if (message.method === "account/login/completed" || message.method === "account/updated" || message.method === "mcpServer/startupStatus/updated") {
        this.emit("status", { method: message.method, params: message.params });
      }
    });
    child.on("error", (error) => {
      this.child = null;
      const processError = error as NodeJS.ErrnoException;
      this.failPending(processError.code === "ENOENT"
        ? new Error("Codex CLI was not found. Install Codex CLI or set CODEX_EXECUTABLE to its path.")
        : error);
    });
    child.on("exit", (code) => {
      this.child = null;
      this.turnId = null;
      this.failPending(new Error(code === 0 ? "Codex app-server stopped." : this.friendlyProcessError()));
      this.emit("process", { code });
    });
    await this.rpc("initialize", {
      clientInfo: { name: "layerling", title: "Layerling", version: "1.111.0" },
    });
    this.notify("initialized", {});
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

  async status() {
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
    };
  }

  async login() {
    await this.start();
    return this.rpc("account/login/start", { type: "chatgpt", useHostedLoginSuccessPage: true, appBrand: "chatgpt" });
  }

  async send(text: string, threadId: string | null, model: string, effort: string) {
    if (!text.trim()) throw new Error("Enter a message first.");
    await this.start();
    const thread = threadId
      ? await this.rpc("thread/resume", { threadId, excludeTurns: true })
      : await this.rpc("thread/start", { model, cwd: process.cwd(), approvalPolicy: "never", sandbox: "read-only", serviceName: "layerling" });
    this.threadId = thread.thread?.id;
    if (!this.threadId) throw new Error("Codex could not open the conversation.");
    const prompt = `You are Layerling's CAD assistant. Use the layerling MCP tools to inspect and change the open design. Read only the scene context needed for the request. Make requested changes in the editor, preserve existing design where possible, and verify CAD changes by reading the scene again. Never delete objects, clear history, or remove attachments unless the user explicitly asks. If dimensions or intent are materially ambiguous, ask a concise question. Explain assumptions and report what you changed.\n\nUser request: ${text.trim()}`;
    const result = await this.rpc("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text: prompt }],
      model,
      effort,
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
    });
    this.turnId = result?.turn?.id ?? null;
    this.emit("turnStarted", { threadId: this.threadId, turnId: this.turnId });
    return { threadId: this.threadId, turnId: this.turnId };
  }

  async cancel() {
    if (!this.threadId || !this.turnId) return;
    await this.rpc("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
  }

  readEvents(after: number) {
    return { events: this.events.filter((event) => event.id > after), latest: this.eventId, running: Boolean(this.turnId) };
  }
}

const globalWithCodex = globalThis as typeof globalThis & { __layerlingCodexServer?: CodexAppServer };
export const codexAssistantServer = globalWithCodex.__layerlingCodexServer ??= new CodexAppServer();
