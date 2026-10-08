import type { Metadata } from "next";
import { interV3, ThemeV3, Toaster } from "@content-ventures/design-system/v3";
import { RuntimeProvider } from "@/state";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Reporter IA", template: "%s · Reporter IA" },
  description: "Automação de fluxos de produção editorial da Content Ventures.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={interV3.variable}>
      <body>
        <ThemeV3>
          <RuntimeProvider>{children}</RuntimeProvider>
          <Toaster />
        </ThemeV3>
      </body>
    </html>
  );
}
