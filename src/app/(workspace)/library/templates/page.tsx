import { Suspense } from "react";
import type { Metadata } from "next";
import { ModelsScreen, ModelsScreenFallback } from "@/features/hard-news/templates/models-screen";
import { TemplatesScreen } from "@/features/library/templates-screen";
import { isReleased } from "@/registries";

export const metadata: Metadata = { title: "Modelos" };

export default function TemplatesPage() {
  // R2 preview only: shelves by family and the model's page. R1 builds render the library as before.
  if (isReleased("R2")) {
    return (
      <Suspense fallback={<ModelsScreenFallback />}>
        <ModelsScreen />
      </Suspense>
    );
  }
  return <TemplatesScreen />;
}
