import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiGet } from "../client.js";

async function apiPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const BASE_URL = "https://api.justcall.io/v2.1";
  const API_KEY = process.env.JUSTCALL_API_KEY ?? "";
  const API_SECRET = process.env.JUSTCALL_API_SECRET ?? "";

  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `${API_KEY}:${API_SECRET}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JustCall API error ${res.status} on ${path}: ${text}`);
  }

  return res.json();
}

export function registerBlocklistTools(server: McpServer): void {
  server.tool(
    "justcall-list-blocklist",
    "List all phone numbers currently on the JustCall block list.",
    {
      page: z.number().optional().default(1).describe("Page number"),
      per_page: z.number().optional().default(50).describe("Results per page (max 100)"),
    },
    async ({ page, per_page }) => {
      const res = await apiGet("/blocklist", { page, per_page });
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    }
  );

  server.tool(
    "justcall-add-to-blocklist",
    "Add a phone number to the JustCall block list. Blocked numbers cannot call in or be called.",
    {
      phone_number: z
        .string()
        .describe("Phone number to block (E.164 format recommended, e.g. +12135551234)"),
      note: z
        .string()
        .optional()
        .describe("Optional reason or note for blocking this number"),
    },
    async ({ phone_number, note }) => {
      const body: Record<string, unknown> = { phone_number };
      if (note) body["note"] = note;

      const res = await apiPost("/blocklist", body);
      return {
        content: [{ type: "text", text: JSON.stringify(res, null, 2) }],
      };
    }
  );
}
