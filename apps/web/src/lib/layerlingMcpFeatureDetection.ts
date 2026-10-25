const REQUIRED_LAYERLING_TOOLS = [
  "layerling_list_editors",
  "layerling_read_scene",
  "layerling_create_shape",
  "layerling_update_object",
];

export function getLayerlingMcpTools(response: unknown): Set<string> {
  if (!response || typeof response !== "object") return new Set();
  const data = (response as { data?: unknown }).data;
  if (!Array.isArray(data)) return new Set();
  const server = data.find((item) => item && typeof item === "object" &&
    ((item as { name?: unknown }).name === "layerling" || (item as { serverName?: unknown }).serverName === "layerling"));
  const tools = server && typeof server === "object" ? (server as { tools?: unknown }).tools : undefined;
  if (Array.isArray(tools)) {
    return new Set(tools.flatMap((tool) => tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string"
      ? [(tool as { name: string }).name]
      : []));
  }
  // Codex App Server v2 serializes tools as a name-keyed object, not as the
  // MCP tools/list array. Keep array support for older app-server responses.
  if (!tools || typeof tools !== "object") return new Set();
  return new Set(Object.entries(tools).flatMap(([name, tool]) => tool && typeof tool === "object" ? [name] : []));
}

export function missingRequiredLayerlingTools(response: unknown): string[] {
  const available = getLayerlingMcpTools(response);
  return REQUIRED_LAYERLING_TOOLS.filter((name) => !available.has(name));
}
