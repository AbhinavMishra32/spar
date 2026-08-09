#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CodeforcesGateway, LeetCodeGateway, type PracticeGateway } from "../gateway.js";
import { parseCodeforcesCookies, type CodeforcesSession } from "../codeforces/session.js";
import { parseLeetCodeCookie, type LeetCodeSession } from "../leetcode/session.js";
import { practiceRegionSchema } from "../types.js";
import { createPracticeMcpServer } from "./server.js";

/**
 * The same practice server, over stdio, for any MCP client.
 *
 * Spar connects to this registry in-process (see `client.ts`); this entry point
 * exists so the work is not locked inside the app. Point Claude Code, or any other
 * MCP client, at `spar-practice-mcp` and it gets the same tools Spar's own agent
 * has — plus the two that judge, because here the person driving the client is the
 * one asking for a submission.
 *
 * Credentials come from the environment and nowhere else. There is no config file
 * and no prompt: a server that reads a cookie out of a file on disk is a server
 * that leaks one, and this is a credential that can spend the learner's account.
 *
 *   LEETCODE_SESSION   the LEETCODE_SESSION cookie, or a whole Cookie header
 *   LEETCODE_CSRF      the csrftoken cookie (not needed if the header has it)
 *   LEETCODE_REGION    "global" (default) or "cn"
 *   PRACTICE_SOURCE    "leetcode" (default) or "codeforces"
 *   CODEFORCES_HANDLE, CODEFORCES_COOKIE and CODEFORCES_CSRF for Codeforces
 *
 * Everything is written to stderr. stdout is the protocol.
 */
async function main() {
  const source = process.env.PRACTICE_SOURCE?.trim().toLowerCase() === "codeforces" ? "codeforces" : "leetcode";
  const region = practiceRegionSchema.catch("global").parse(process.env.LEETCODE_REGION?.trim() || "global");
  const session = source === "leetcode" ? sessionFromEnvironment(region) : codeforcesSessionFromEnvironment();
  if (!session) {
    process.stderr.write(
      `spar-practice-mcp: no ${source === "leetcode" ? "LeetCode" : "Codeforces"} session in the environment. Set the source's handle/cookie/CSRF variables to enable account reads and submissions.\n` +
      "Problem statements are public, so search and reads still work; the learner's history and the judge do not.\n",
    );
  }
  const gateway: PracticeGateway = source === "leetcode"
    ? new LeetCodeGateway(region, async () => session as LeetCodeSession | null, { onExpired: () => process.stderr.write("spar-practice-mcp: LeetCode refused the session; it has expired.\n") })
    : new CodeforcesGateway(async () => session as CodeforcesSession | null, { onExpired: () => process.stderr.write("spar-practice-mcp: Codeforces refused the session; it has expired.\n") });
  /* Judging is on here and off for Spar's own agent. The difference is who asked:
     a person typing into an MCP client is deciding to submit their own work,
     where Spar's agent would be submitting on someone's behalf. */
  const server = createPracticeMcpServer({ gateway, allowJudging: true });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`spar-practice-mcp: serving ${source === "leetcode" ? `LeetCode (${region})` : "Codeforces"}${session ? " with a session" : " unauthenticated"}.\n`);
}

function codeforcesSessionFromEnvironment(): CodeforcesSession | null {
  const cookie = process.env.CODEFORCES_COOKIE?.trim() ?? "";
  const handle = process.env.CODEFORCES_HANDLE?.trim() ?? "";
  const csrf = process.env.CODEFORCES_CSRF?.trim() ?? "";
  if (!cookie || !handle || !csrf) return null;
  try { return parseCodeforcesCookies(cookie, handle, csrf); }
  catch (error) { process.stderr.write(`spar-practice-mcp: ${error instanceof Error ? error.message : String(error)}\n`); return null; }
}

function sessionFromEnvironment(region: "global" | "cn"): LeetCodeSession | null {
  const raw = process.env.LEETCODE_SESSION?.trim() ?? "";
  if (!raw) return null;
  /* A whole Cookie header is accepted as well as the bare value, because that is
     what a browser's devtools hands you and asking someone to split it by hand is
     asking them to paste the wrong half. */
  const header = raw.includes("LEETCODE_SESSION=")
    ? raw
    : `LEETCODE_SESSION=${raw}; csrftoken=${process.env.LEETCODE_CSRF?.trim() ?? ""}`;
  const parsed = parseLeetCodeCookie(header, region);
  if ("error" in parsed) {
    process.stderr.write(`spar-practice-mcp: ${parsed.error}\n`);
    return null;
  }
  return parsed.session;
}

main().catch((error: unknown) => {
  process.stderr.write(`spar-practice-mcp: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
