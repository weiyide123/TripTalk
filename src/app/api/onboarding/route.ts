import { z } from "zod";
import { getStore } from "@/server/storage/store";
import { body, handle } from "@/server/http";
export const runtime = "nodejs";
export function PATCH(request: Request) {
  return handle(request, async () => {
    await body(request, z.object({}).strict());
    return getStore().profile.completeOnboarding();
  });
}
