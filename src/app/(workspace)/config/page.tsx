import type { Metadata } from 'next';
import { PipelineScreen } from '@/features/pipeline/pipeline-screen';

export const metadata: Metadata = { title: 'Engenharia de prompts' };
export default function ConfigPage() { return <PipelineScreen />; }
