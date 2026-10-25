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
  try {
    if (url.searchParams.get("action") === "events") {
      const since = Number(url.searchParams.get("since") || 0);
      return NextResponse.json(codexAssistantServer.readEvents(Number.isFinite(since) ? since : 0));
    }
    return NextResponse.json(await codexAssistantServer.status());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not connect to Codex." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const blocked = allowed(request);
  if (blocked) return blocked;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  try {
    if (body?.action === "login") {
      return NextResponse.json(await codexAssistantServer.login());
    }
    if (body?.action === "send") {
      if (typeof body.text !== "string" || typeof body.model !== "string" || typeof body.effort !== "string") {
        return NextResponse.json({ error: "A message, model and reasoning level are required." }, { status: 400 });
      }
      const threadId = typeof body.threadId === "string" ? body.threadId : null;
      return NextResponse.json(await codexAssistantServer.send(body.text, threadId, body.model, body.effort));
    }
    if (body?.action === "cancel") {
      await codexAssistantServer.cancel();
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "status") return NextResponse.json(await codexAssistantServer.status());
    return NextResponse.json({ error: "Unknown Codex assistant action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Codex could not complete the request." }, { status: 503 });
  }
}
