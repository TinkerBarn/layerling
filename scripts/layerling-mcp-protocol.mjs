// MCP protocol versions that use the initialize handshake. The server implements
// their shared baseline (tools, JSON-RPC framing and graceful notifications).
export const MCP_HANDSHAKE_VERSIONS = [
  "2024-11-05",
  "2025-03-26",
  "2025-06-18",
  "2025-11-25",
];

export function negotiateMcpProtocolVersion(requested) {
  return MCP_HANDSHAKE_VERSIONS.includes(requested)
    ? requested
    : MCP_HANDSHAKE_VERSIONS[MCP_HANDSHAKE_VERSIONS.length - 1];
}
