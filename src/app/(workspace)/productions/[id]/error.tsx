"use client";

import { RouteError } from "@/features/common/route-error";
import { PRODUCTIONS_HREF } from "@/ui/routes";

export default function ProductionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <RouteError error={error} retry={retry} size="panel" back={{ label: "Ver produções", href: PRODUCTIONS_HREF }} />;
}
