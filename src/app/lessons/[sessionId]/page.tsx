import { Conversation } from "@/features/conversation/Conversation";
export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { sessionId } = await params;
  const query = await searchParams;
  const source =
    typeof query.turn === "string" && typeof query.part === "string"
      ? { turnId: query.turn, part: query.part }
      : undefined;
  return (
    <Conversation
      key={sessionId}
      sessionId={sessionId}
      source={source}
    />
  );
}
