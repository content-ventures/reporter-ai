import { permanentRedirect } from "next/navigation";

/** The prototype's release notes moved to "Novidades"; "Versões" now means content versions. */
export default function VersionsPage() {
  permanentRedirect("/whats-new");
}
