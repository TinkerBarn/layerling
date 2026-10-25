import { describe, expect, it } from "vitest";
import { getLayerlingMcpTools, missingRequiredLayerlingTools } from "@/lib/layerlingMcpFeatureDetection";

describe("Codex Layerling MCP feature detection", () => {
  it("requires a configured Layerling server and the core editor tools", () => {
    expect(missingRequiredLayerlingTools({ data: [] })).toEqual([
      "layerling_list_editors",
      "layerling_read_scene",
      "layerling_create_shape",
      "layerling_update_object",
    ]);
    const response = { data: [{ name: "layerling", tools: [
      { name: "layerling_list_editors" },
      { name: "layerling_read_scene" },
      { name: "layerling_create_shape" },
      { name: "layerling_update_object" },
    ] }] };
    expect(missingRequiredLayerlingTools(response)).toEqual([]);
    expect(getLayerlingMcpTools(response).size).toBe(4);
  });

  it("reads the name-keyed tool map returned by Codex App Server v2", () => {
    const response = { data: [{ name: "layerling", tools: {
      layerling_list_editors: { name: "layerling_list_editors", description: "List editors" },
      layerling_read_scene: { name: "layerling_read_scene", description: "Read scene" },
      layerling_create_shape: { name: "layerling_create_shape", description: "Create shape" },
      layerling_update_object: { name: "layerling_update_object", description: "Update object" },
    } }] };
    expect(missingRequiredLayerlingTools(response)).toEqual([]);
    expect(getLayerlingMcpTools(response).size).toBe(4);
  });

  it("does not accept similarly named tools from a different MCP server", () => {
    expect(missingRequiredLayerlingTools({ data: [{ name: "other", tools: [{ name: "layerling_read_scene" }] }] })).toEqual([
      "layerling_list_editors",
      "layerling_read_scene",
      "layerling_create_shape",
      "layerling_update_object",
    ]);
  });

  it("treats malformed server responses as unavailable rather than connected", () => {
    for (const response of [null, {}, { data: null }, { data: [{ name: "layerling", tools: null }] }]) {
      expect(missingRequiredLayerlingTools(response)).toHaveLength(4);
    }
  });
});
