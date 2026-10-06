import type { Metadata } from "next";
import {
  interV3,
  ThemeV3,
} from "@content-ventures/design-system/v3";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reporter IA",
  description: "Automação de fluxos de produção editorial da Content Ventures.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={interV3.variable}>
      <body>
        <ThemeV3>{children}</ThemeV3>
      </body>
    </html>
  );
}
