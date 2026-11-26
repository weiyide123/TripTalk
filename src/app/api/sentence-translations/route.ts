import { favoriteSourceSchema } from "@/contracts/favorite";
import { body, handle } from "@/server/http";
import { translateSentence } from "@/server/services/translate-sentence";

export const runtime = "nodejs";

export function POST(request: Request) {
  return handle(request, async () =>
    translateSentence(await body(request, favoriteSourceSchema)),
  );
}
