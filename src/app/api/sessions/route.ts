import { createRequestSchema } from "@/contracts/requests";
import { createSession } from "@/server/services/create-session";
import { body, handle } from "@/server/http";
export const runtime = "nodejs";
export function POST(request: Request) {
  return handle(request, async () =>
    createSession(await body(request, createRequestSchema)),
  );
}
