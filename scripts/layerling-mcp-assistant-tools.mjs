export const ASSISTANT_DISABLED_TOOLS = new Set([
  "layerling_export_mesh",
  "layerling_save_project",
]);

export function toolsForCodexAssistant(tools) {
  return tools.filter((tool) => !ASSISTANT_DISABLED_TOOLS.has(tool.name));
}
