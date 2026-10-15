import { permanentRedirect } from "next/navigation";

/** Preserve the legacy address for the product version history. */
export default function VersionsPage() {
  permanentRedirect("/whats-new");
}
