import { turnRequestSchema } from "@/contracts/requests";
import { submitTurn } from "@/server/services/turn";
import { body, handle } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  return handle(request, async () => {
    const input = await body(request, turnRequestSchema);
    if (input.action === "continue")
      throw new AppError("INVALID_ACTION", "请使用确认接口。");
    return submitTurn((await context.params).sessionId, input);
  });
}
