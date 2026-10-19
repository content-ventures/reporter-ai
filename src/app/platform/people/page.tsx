import type { Metadata } from 'next';
import { PeopleScreen } from '@/features/platform/people-screen';

export const metadata: Metadata = { title: 'Pessoas · Plataforma' };

export default function PlatformPeoplePage() {
  return <PeopleScreen />;
}
