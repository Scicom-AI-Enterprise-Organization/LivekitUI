/**
 * Reusable tool definitions.
 *
 * The agent builder stores a *copy* of each tool inside the agent's config, so
 * an agent keeps working even if the library entry is later changed or deleted.
 * The library is a starting point, not a live reference.
 */

export type ToolKind = "http" | "client" | "mcp";

export interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface HttpTool {
  name: string;
  description: string;
  method: string;
  url: string;
  params: ToolParam[];
  headers: { name: string; value: string }[];
}

export interface ClientTool {
  name: string;
  description: string;
  params: ToolParam[];
}

export interface McpServer {
  name: string;
  url: string;
  headers: { name: string; value: string }[];
}

/** A library entry: one of the three shapes above, plus its row metadata. */
export interface LibraryTool {
  id: number;
  kind: ToolKind;
  name: string;
  description: string;
  config: HttpTool | ClientTool | McpServer;
  createdAt: string;
  updatedAt: string;
}

export const TOOL_KINDS: { kind: ToolKind; label: string; blurb: string }[] = [
  { kind: "http", label: "HTTP tools", blurb: "Call an external API. The agent fills the parameters and the response comes back as the tool result." },
  { kind: "client", label: "Client tools", blurb: "Run in the frontend session rather than on the server — the client handles the call and returns the result." },
  { kind: "mcp", label: "MCP servers", blurb: "Every tool the MCP server exposes becomes available to the agent." },
];

export function emptyToolConfig(kind: ToolKind): HttpTool | ClientTool | McpServer {
  if (kind === "http") {
    return { name: "", description: "", method: "GET", url: "", params: [], headers: [] };
  }
  if (kind === "client") {
    return { name: "", description: "", params: [] };
  }
  return { name: "", url: "", headers: [] };
}

/**
 * Tool names reach the LLM as function names, so they have to be valid
 * identifiers — snake_case, no spaces.
 */
export function isValidToolName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

/**
 * Filled in by the "Example" button in each dialog. Real, working endpoints so
 * a new tool can be tried immediately rather than being a blank form.
 */
export function exampleTool(kind: ToolKind): {
  name: string;
  description: string;
  config: HttpTool | ClientTool | McpServer;
} {
  if (kind === "http") {
    return {
      name: "get_weather",
      description: "Look up the current weather for a set of coordinates",
      config: {
        name: "get_weather",
        description: "Look up the current weather for a set of coordinates",
        method: "GET",
        // Open-Meteo needs no API key, so this example works as-is.
        url: "https://api.open-meteo.com/v1/forecast",
        params: [
          { name: "latitude", type: "number", description: "Latitude of the location", required: true },
          { name: "longitude", type: "number", description: "Longitude of the location", required: true },
          { name: "current", type: "string", description: 'Fields to return, e.g. "temperature_2m"', required: false },
        ],
        headers: [],
      },
    };
  }

  if (kind === "client") {
    return {
      name: "show_location_on_map",
      description: "Display a location on the map in the user's browser",
      config: {
        name: "show_location_on_map",
        description: "Display a location on the map in the user's browser",
        params: [
          { name: "latitude", type: "number", description: "Latitude to centre on", required: true },
          { name: "longitude", type: "number", description: "Longitude to centre on", required: true },
          { name: "label", type: "string", description: "Pin label", required: false },
        ],
      },
    };
  }

  return {
    name: "example_mcp",
    description: "",
    config: {
      name: "example_mcp",
      // Matches the sample server in mcp-example/ — run `npm run mcp:example`.
      url: "http://localhost:7900/sse",
      headers: [],
    },
  };
}
