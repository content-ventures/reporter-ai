"use client";

import { RouteError } from "@/features/common/route-error";

export default function ProductionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} size="panel" />;
}
