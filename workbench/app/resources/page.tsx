import { redirect } from 'next/navigation';
import ResourcesClient from '@/components/workbench/ResourcesClient';
import { isLiveModel } from '@/lib/ark';
import { getSessionUser } from '@/lib/current-user';

export const dynamic = 'force-dynamic';

export default async function ResourcesPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return <ResourcesClient userName={user.name} liveModel={isLiveModel()} />;
}
