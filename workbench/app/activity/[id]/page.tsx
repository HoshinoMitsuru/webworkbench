import { redirect } from 'next/navigation';
import ActivityWorkspace from '@/components/workbench/ActivityWorkspace';
import { isLiveModel } from '@/lib/ark';
import { getSessionUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function ActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const { id } = await params;

  return (
    <ActivityWorkspace
      activityId={id}
      user={{ id: user.uid, name: user.name }}
      liveModel={isLiveModel()}
      paused={process.env.PAUSED === '1'}
    />
  );
}
