import { z } from "zod";
import { AppError } from "@/server/errors";
import { handle } from "@/server/http";
import { getStore } from "@/server/storage/store";

export const runtime = "nodejs";

export function DELETE(
  request: Request,
  context: { params: Promise<{ favoriteId: string }> },
) {
  return handle(request, async () => {
    const { favoriteId } = await context.params;
    if (!z.string().uuid().safeParse(favoriteId).success) {
      throw new AppError("INVALID_INPUT", "收藏编号无效。", 400);
    }
    return getStore().favorites.remove(favoriteId);
  });
}
