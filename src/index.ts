#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCallsTools } from "./tools/calls.js";
import { registerAgentsTools } from "./tools/agents.js";
import { registerBlocklistTools } from "./tools/blocklist.js";

async function main(): Promise<void> {
  if (!process.env.JUSTCALL_API_KEY || !process.env.JUSTCALL_API_SECRET) {
    console.error(
      "[justcall-mcp] WARNING: JUSTCALL_API_KEY or JUSTCALL_API_SECRET not set — server will start but auth will fail"
    );
  }

  const server = new McpServer({
    name: "justcall",
    version: "1.0.0",
  });

  registerCallsTools(server);
  registerAgentsTools(server);
  registerBlocklistTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[justcall-mcp] Server started on stdio transport");
}

main().catch((err) => {
  console.error("[justcall-mcp] Fatal error:", err);
  process.exit(1);
});
