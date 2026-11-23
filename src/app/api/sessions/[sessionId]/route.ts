import { getSessionView } from "@/server/services/views";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handle(request, async () =>
    getSessionView((await context.params).sessionId),
  );
}
