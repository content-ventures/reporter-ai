import { redirect } from 'next/navigation';

/** The earlier Hard News demonstration lived here; the radar is at /news. */
export default function Page() {
  redirect('/news');
}
