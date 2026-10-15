import { after } from "next/server";
import { handleReporter } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path?: string[] }> };
// Worker wake-ups run after the response so the request never waits on the worker.
const deps = { defer: (task: () => Promise<void>) => after(task) };
export async function GET(request: Request, context: Context) {
  return handleReporter(request, (await context.params).path ?? [], deps);
}
export async function POST(request: Request, context: Context) {
  return handleReporter(request, (await context.params).path ?? [], deps);
}
