import type { ProjectRole } from "@prisma/client";
import { isProjectAdminRole } from "./auth.js";

export type ViewerMembership = {
  id: string;
  userId: string;
  role: ProjectRole;
};

type VisibleUser = {
  id: string;
};

type VisibleProjectMember = {
  id: string;
  user: VisibleUser;
};

type VisibleTaskGroup = {
  id: string;
  members: VisibleProjectMember[];
};

type VisibleTask = {
  assignee: VisibleUser | null;
  assigneeGroup: VisibleTaskGroup | null;
};

type VisibleEvent = {
  taskId: string | null;
  payload: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function visibleTaskFromUnknown(value: unknown): VisibleTask | null {
  if (!isRecord(value)) {
    return null;
  }

  const assignee = isRecord(value.assignee) && typeof value.assignee.id === "string" ? { id: value.assignee.id } : null;
  const assigneeGroup =
    isRecord(value.assigneeGroup) &&
    Array.isArray(value.assigneeGroup.members) &&
    value.assigneeGroup.members.every(
      (member) => isRecord(member) && typeof member.id === "string" && isRecord(member.user) && typeof member.user.id === "string"
    )
      ? {
          id: typeof value.assigneeGroup.id === "string" ? value.assigneeGroup.id : "",
          members: value.assigneeGroup.members.map((member) => ({
            id: member.id as string,
            user: {
              id: (member.user as { id: string }).id
            }
          }))
        }
      : null;

  if (!("assignee" in value) && !("assigneeGroup" in value)) {
    return null;
  }

  return {
    assignee,
    assigneeGroup
  };
}

function eventTaskSnapshots(event: VisibleEvent) {
  const payload = isRecord(event.payload) ? event.payload : null;
  if (!payload) {
    return [];
  }

  const candidates = [
    visibleTaskFromUnknown(payload),
    visibleTaskFromUnknown(payload.task),
    visibleTaskFromUnknown(payload.previousTask),
    visibleTaskFromUnknown(payload.previous)
  ];

  return candidates.filter((task): task is VisibleTask => task !== null);
}

function canViewFullBoard(viewer?: ViewerMembership | null) {
  return !viewer || isProjectAdminRole(viewer.role);
}

function canViewFullEventHistory(viewer?: ViewerMembership | null) {
  return !viewer || viewer.role === "OWNER" || viewer.role === "MEMBER";
}

export function taskIsVisibleToViewer(task: VisibleTask, viewer?: ViewerMembership | null) {
  if (!viewer || canViewFullBoard(viewer)) {
    return true;
  }

  if (task.assignee?.id === viewer.userId) {
    return true;
  }

  return Boolean(
    task.assigneeGroup?.members.some((member) => member.id === viewer.id || member.user.id === viewer.userId)
  );
}

export function filterBoardForViewer<
  TBoard extends {
    columns: Array<{
      tasks: VisibleTask[];
    }>;
  }
>(board: TBoard, viewer?: ViewerMembership | null): TBoard {
  if (canViewFullBoard(viewer)) {
    return board;
  }

  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      tasks: column.tasks.filter((task) => taskIsVisibleToViewer(task, viewer))
    }))
  };
}

export function eventIsVisibleToViewer(event: VisibleEvent, viewer?: ViewerMembership | null) {
  if (canViewFullEventHistory(viewer)) {
    return true;
  }

  if (!event.taskId) {
    return false;
  }

  if (viewer?.role !== "ADMIN") {
    return false;
  }

  return eventTaskSnapshots(event).some((task) => task.assignee?.id === viewer.userId);
}
