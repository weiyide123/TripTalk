import { handle } from "@/server/http";
import { getStore } from "@/server/storage/store";

export const runtime = "nodejs";

export function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handle(request, async () => {
    const { sessionId } = await context.params;
    return getStore().favorites.forSession(sessionId);
  });
}
