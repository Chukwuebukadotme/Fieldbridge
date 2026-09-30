import { hasServerKey } from "@/lib/ai/server";

export const dynamic = "force-dynamic";

/** Whether the server has its own provider keys configured. Reports booleans only, never key values. */
export async function GET() {
  return Response.json(
    { serverKeys: { openai: hasServerKey("openai"), anthropic: hasServerKey("anthropic") } },
    { headers: { "cache-control": "no-store" } },
  );
}
