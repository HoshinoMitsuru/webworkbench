import { redirect } from 'next/navigation';
import Studio from '@/components/Studio';
import { isLiveModel } from '@/lib/ark';
import { getSessionUser } from '@/lib/current-user';
import { hasExampleActivity } from '@/lib/example';

export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <Studio
      liveModel={isLiveModel()}
      paused={process.env.PAUSED === '1'}
      user={{ id: user.uid, name: user.name }}
      exampleAvailable={hasExampleActivity()}
    />
  );
}
