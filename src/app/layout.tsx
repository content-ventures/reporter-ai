import type { Metadata, Viewport } from "next";
import { interV3, ThemeV3, Toaster } from "@content-ventures/design-system/v3";
import { PRODUCT_DESCRIPTION, PRODUCT_NAME, PRODUCT_TITLE } from '@/lib/brand';
import { BRAND_OPEN_GRAPH, BRAND_SHARE_IMAGE, SITE_URL } from '@/lib/site';
import {AccountBoundary} from '@/state/account-boundary';
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: { default: PRODUCT_TITLE, template: `%s · ${PRODUCT_NAME}` },
  description: PRODUCT_DESCRIPTION,
  applicationName: PRODUCT_NAME,
  authors: [{ name: 'Content Ventures', url: 'https://contentventures.com.br' }],
  creator: 'Content Ventures',
  publisher: 'Content Ventures',
  // Workspace content is private. Only the public sign-in page opts into indexing.
  robots: { index: false, follow: false },
  openGraph: BRAND_OPEN_GRAPH,
  twitter: { card: 'summary_large_image', title: PRODUCT_TITLE, description: PRODUCT_DESCRIPTION, images: [BRAND_SHARE_IMAGE] },
  appleWebApp: { capable: true, title: PRODUCT_NAME, statusBarStyle: 'default' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { themeColor: '#0875DB', colorScheme: 'light' };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={interV3.variable}>
      <body>
        <ThemeV3>
          <AccountBoundary>{children}</AccountBoundary>
          <Toaster />
        </ThemeV3>
      </body>
    </html>
  );
}
