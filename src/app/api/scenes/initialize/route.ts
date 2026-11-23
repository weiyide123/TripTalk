import { courseInitializationSchema } from "@/contracts/requests";
import { initializeScene } from "@/server/services/scene-plan";
import { homeView } from "@/server/services/views";
import { body, handle } from "@/server/http";
export const runtime = "nodejs";
export function POST(request: Request) {
  return handle(request, async () => {
    const input = await body(request, courseInitializationSchema);
    await initializeScene(input);
    return homeView(input.sceneId);
  });
}
