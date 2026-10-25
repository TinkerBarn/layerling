import { describe, expect, it } from "vitest";
import { approvalMatches } from "@/lib/codexAssistantApproval";

describe("Codex approval request binding", () => {
  const pending = { __layerlingClientId: "tab-session-123", __layerlingMethod: "mcpServer/elicitation/request", __layerlingNonce: "e66242e2-7b01-4b99-92f0-186204626a5a" };

  it("accepts only the exact session, method, and nonce", () => {
    expect(approvalMatches(pending, "tab-session-123", "mcpServer/elicitation/request", pending.__layerlingNonce)).toBe(true);
    expect(approvalMatches(pending, "other-session-123", "mcpServer/elicitation/request", pending.__layerlingNonce)).toBe(false);
    expect(approvalMatches(pending, "tab-session-123", "execCommandApproval", pending.__layerlingNonce)).toBe(false);
    expect(approvalMatches(pending, "tab-session-123", "mcpServer/elicitation/request", "c6223285-dc44-4cc1-a720-6693240e6e6f")).toBe(false);
  });

  it("does not let an old approval card answer a reused RPC id", () => {
    const reusedId = { ...pending, __layerlingNonce: "4e3186b4-a3fa-42c2-bda6-02f4658a9694" };
    expect(approvalMatches(reusedId, "tab-session-123", "mcpServer/elicitation/request", pending.__layerlingNonce)).toBe(false);
  });

  it("rejects an absent pending request", () => {
    expect(approvalMatches(undefined, "tab-session-123", "mcpServer/elicitation/request", pending.__layerlingNonce)).toBe(false);
  });
});
