import type { Metadata } from 'next';
import { CitationsScreen } from '@/features/citations/citations-screen';
export const metadata: Metadata = { title: 'Citações' };
export default function QuotesPage() { return <CitationsScreen />; }
