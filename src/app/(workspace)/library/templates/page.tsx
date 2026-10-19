import { Suspense } from "react";
import type { Metadata } from "next";
import { ModelsScreen, ModelsScreenFallback } from "@/features/hard-news/templates/models-screen";

export const metadata: Metadata = { title: "Modelos" };

/** Modelos: shelves by family and the model's page, on the workspace's own models in every build. */
export default function TemplatesPage() {
  return (
    <Suspense fallback={<ModelsScreenFallback />}>
      <ModelsScreen />
    </Suspense>
  );
}
