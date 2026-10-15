import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader, PageStack } from '@content-ventures/design-system/v3';
import { PipelineScreen } from '@/features/pipeline/pipeline-screen';

export const metadata: Metadata = { title: 'Prompts' };
export default function ConfigPage() {
  return <Suspense fallback={<PageStack><PageHeader title="Prompts" /></PageStack>}><PipelineScreen /></Suspense>;
}
