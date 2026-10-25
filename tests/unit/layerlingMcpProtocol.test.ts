import { describe, expect, it } from "vitest";
// @ts-expect-error a plain .mjs module
import { MCP_HANDSHAKE_VERSIONS, negotiateMcpProtocolVersion } from "../../scripts/layerling-mcp-protocol.mjs";
// @ts-expect-error a plain .mjs module
import { tools } from "../../scripts/layerling-mcp-tools.mjs";
// @ts-expect-error a plain .mjs module
import { toolsForCodexAssistant } from "../../scripts/layerling-mcp-assistant-tools.mjs";

describe("Layerling MCP protocol negotiation", () => {
  it("keeps a client on a handshake version the server implements", () => {
    for (const version of MCP_HANDSHAKE_VERSIONS as string[]) {
      expect(negotiateMcpProtocolVersion(version)).toBe(version);
    }
  });

  it("offers the latest implemented handshake version to unknown and future versions", () => {
    expect(negotiateMcpProtocolVersion("2026-07-28")).toBe("2025-11-25");
    expect(negotiateMcpProtocolVersion("not-a-version")).toBe("2025-11-25");
    expect(negotiateMcpProtocolVersion(undefined)).toBe("2025-11-25");
  });

  it("advertises a non-empty, unique tools catalogue with input schemas", () => {
    const names = (tools as Array<{ name: string; inputSchema?: unknown }>).map((tool) => tool.name);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
    expect((tools as Array<{ inputSchema?: unknown }>).every((tool) => tool.inputSchema && typeof tool.inputSchema === "object")).toBe(true);
  });

  it("keeps file-writing tools out of the Codex assistant while preserving the standard catalogue", () => {
    const assistantNames = (toolsForCodexAssistant(tools) as Array<{ name: string }>).map((tool) => tool.name);
    expect(assistantNames).not.toContain("layerling_export_mesh");
    expect(assistantNames).not.toContain("layerling_save_project");
    expect((tools as Array<{ name: string }>).map((tool) => tool.name)).toContain("layerling_export_mesh");
    expect((tools as Array<{ name: string }>).map((tool) => tool.name)).toContain("layerling_save_project");
  });
});
