import { Conversation } from "@/features/conversation/Conversation";
export default async function LessonPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <Conversation
      key={sessionId}
      sessionId={sessionId}
    />
  );
}
