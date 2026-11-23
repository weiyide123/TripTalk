import { Home } from "@/features/home/Home";
import { getStore } from "@/server/storage/store";
export const dynamic = "force-dynamic";
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ scene?: string }>;
}) {
  const sceneId = (await searchParams).scene;
  const profile = sceneId == null ? await getStore().profile.read() : null;
  // 找到最近一次的场景id 没有的话默认scene[0]
  const scene = getStore().catalog.resolveHomeScene(
    sceneId,
    profile?.lastSceneId,
  );
  return (
    <Home
      key={scene.id}
      sceneId={scene.id}
    />
  );
}
