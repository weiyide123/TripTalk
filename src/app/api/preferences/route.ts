import { preferencesSchema } from "@/contracts/requests";
import { body, handle } from "@/server/http";
import { getStore } from "@/server/storage/store";
export const runtime = "nodejs";
export function PATCH(request: Request) {
  return handle(request, async () => {
    const input = await body(request, preferencesSchema);
    return getStore().profile.updatePreferences(input);
  });
}
