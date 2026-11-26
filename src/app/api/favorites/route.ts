import {
  favoriteQuerySchema,
  favoriteSourceSchema,
} from "@/contracts/favorite";
import { AppError } from "@/server/errors";
import { body, handle } from "@/server/http";
import { getStore } from "@/server/storage/store";

export const runtime = "nodejs";

export function GET(request: Request) {
  return handle(request, () => {
    const query = favoriteQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success)
      throw new AppError("INVALID_INPUT", "收藏筛选条件无效。", 400);
    return getStore().favorites.list(query.data);
  });
}

export function POST(request: Request) {
  return handle(request, async () => {
    const input = await body(request, favoriteSourceSchema);
    return getStore().favorites.save(input);
  });
}
