import { redirect } from 'next/navigation';
import ActivitiesClient from '@/components/workbench/ActivitiesClient';
import { isLiveModel } from '@/lib/ark';
import { getSessionUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function ActivitiesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <ActivitiesClient
      user={{ id: user.uid, name: user.name }}
      liveModel={isLiveModel()}
      paused={process.env.PAUSED === '1'}
    />
  );
}
