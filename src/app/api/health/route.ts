import { getConfigurationStatus } from "@/server/web-entry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  const allowedHosts = new Set(["127.0.0.1:3000", "localhost:3000"]);
  if (
    !host ||
    !allowedHosts.has(host) ||
    (origin !== null && origin !== `http://${host}`) ||
    url.port !== "3000"
  ) {
    return Response.json(
      { error: "LOCAL_REQUEST_REQUIRED" },
      {
        status: 403,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  return Response.json(
    {
      status: "ok",
      service: "triptalk",
      ai: {
        ...getConfigurationStatus(),
        connectionVerified: false,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
