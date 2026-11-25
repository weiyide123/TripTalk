import { customSceneRequestSchema } from "@/contracts/requests";
import { body, handle } from "@/server/http";
import { getStore } from "@/server/storage/store";

export const runtime = "nodejs";

/** 保存场景，不调用模型；创建成功后由页面单独保存选择并沿用课程生成入口。 */
export function POST(request: Request) {
  return handle(request, async () => {
    const input = await body(request, customSceneRequestSchema);
    return getStore().catalog.createCustom(input);
  });
}
