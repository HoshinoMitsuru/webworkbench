import { getActivity, type ActivityRecord } from '@/lib/activities';
import { listMaterials, type MaterialUser } from '@/lib/materials';
import { listOutputs, listPublishes, listReviews, listRuns } from '@/lib/outputs';
import { listPosters } from '@/lib/posters';
import { listTasks } from '@/lib/tasks';
import type { ActivityDetail, WorkspacePayload } from '@/lib/workspace-types';

export function toActivityDetail(record: ActivityRecord): ActivityDetail {
  return {
    id: record.id,
    title: record.title,
    data: record.data,
    results: record.results,
    audience: record.audience,
    version: record.version,
    status: record.status,
    ownerName: record.ownerName,
    stage: record.stage,
    workflow: record.workflow,
    archivedAt: record.archivedAt,
    createdById: record.createdById,
    createdByName: record.createdByName,
    updatedById: record.updatedById,
    updatedByName: record.updatedByName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export function getWorkspace(activityId: string, user: MaterialUser): WorkspacePayload | null {
  const activity = getActivity(activityId);
  if (!activity) return null;

  return {
    activity: toActivityDetail(activity),
    tasks: listTasks(activityId),
    materials: listMaterials(activityId, user),
    outputs: listOutputs(activityId),
    reviews: listReviews(activityId),
    publishes: listPublishes(activityId),
    posters: listPosters(activityId),
    runs: listRuns(activityId)
  };
}
