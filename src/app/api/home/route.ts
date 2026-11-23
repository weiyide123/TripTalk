import { homeView } from "@/server/services/views";
import { handle } from "@/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return handle(request, () =>
    homeView(new URL(request.url).searchParams.get("sceneId")),
  );
}
