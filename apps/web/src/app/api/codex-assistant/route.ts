import { NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/layerlingMcpLocalRequest";
import { codexAssistantServer } from "@/lib/codexAssistantServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowed(request: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "The Codex assistant is available in a local Layerling development server only." }, { status: 404 });
  if (!isLocalRequest(request)) return NextResponse.json({ error: "The Codex assistant only accepts requests from this computer." }, { status: 403 });
  return null;
}

export async function GET(request: Request) {
  const blocked = allowed(request);
  if (blocked) return blocked;
  const url = new URL(request.url);
  const baseUrl = url.origin;
  try {
    if (url.searchParams.get("action") === "mcp-status") {
      return NextResponse.json(await codexAssistantServer.mcpStatus(baseUrl));
    }
    if (url.searchParams.get("action") === "events") {
      const since = Number(url.searchParams.get("since") || 0);
      const clientId = url.searchParams.get("clientId") || "";
      return NextResponse.json(codexAssistantServer.readEvents(clientId, Number.isFinite(since) ? since : 0));
    }
    return NextResponse.json(await codexAssistantServer.status(baseUrl, url.searchParams.get("clientId") || ""));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect to Codex." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const blocked = allowed(request);
  if (blocked) return blocked;
  const baseUrl = new URL(request.url).origin;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    if (body?.action === "login") {
      return NextResponse.json(await codexAssistantServer.login(typeof body.clientId === "string" ? body.clientId : "", baseUrl));
    }
    if (body?.action === "logout") {
      await codexAssistantServer.logout(typeof body.clientId === "string" ? body.clientId : "", baseUrl);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "approval" && typeof body.requestId === "number" && typeof body.method === "string" && typeof body.nonce === "string" && typeof body.questionId === "string" && typeof body.answer === "string") {
      const persistentScope = body.persistentScope === "tool" || body.persistentScope === "all" ? body.persistentScope : undefined;
      await codexAssistantServer.answerApproval(typeof body.clientId === "string" ? body.clientId : "", body.requestId, body.method, body.nonce, body.questionId, body.answer, persistentScope);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "send") {
      if (typeof body.text !== "string" || typeof body.model !== "string" || typeof body.effort !== "string") {
        return NextResponse.json({ error: "A message, model and reasoning level are required." }, { status: 400 });
      }
      const threadId = typeof body.threadId === "string" ? body.threadId : null;
      const clientId = typeof body.clientId === "string" ? body.clientId : "";
      return NextResponse.json(await codexAssistantServer.send(body.text, threadId, body.model, body.effort, baseUrl, clientId));
    }
    if (body?.action === "cancel") {
      await codexAssistantServer.cancel(typeof body.clientId === "string" ? body.clientId : "");
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "status") return NextResponse.json(await codexAssistantServer.status(baseUrl, typeof body.clientId === "string" ? body.clientId : ""));
    return NextResponse.json({ error: "Unknown Codex assistant action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Codex could not complete the request." }, { status: 503 });
  }
}
