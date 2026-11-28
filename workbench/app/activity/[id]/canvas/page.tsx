import { redirect } from 'next/navigation';
import CanvasView from '@/components/workbench/CanvasView';
import { isLiveModel } from '@/lib/ark';
import { getCanvasState } from '@/lib/canvas-state';
import { getSessionUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function ActivityCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const { id } = await params;
  const initial = getCanvasState(id);
  if (!initial) redirect('/activities');

  return (
    <CanvasView
      activityId={id}
      activityTitle={initial.nodes[0]?.title || '活动画布'}
      userName={user.name}
      liveModel={isLiveModel()}
      initial={initial}
    />
  );
}
