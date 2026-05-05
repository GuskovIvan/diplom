import type {
  BoardColumn,
  Announcement,
  AnnouncementRecipient,
  Project,
  ProjectMember,
  Task,
  TaskEvent,
  TaskGroup,
  TaskGroupMember,
  User
} from "@prisma/client";

type ProjectMemberWithUser = ProjectMember & {
  user: Pick<User, "id" | "name" | "email">;
};

type TaskGroupWithMembers = TaskGroup & {
  members: Array<TaskGroupMember & { member: ProjectMemberWithUser }>;
};

type ColumnWithTasks = BoardColumn & {
  tasks: Array<
    Task & {
      creator: Pick<User, "id" | "name" | "email">;
      assignee: Pick<User, "id" | "name" | "email"> | null;
      assigneeGroup: TaskGroupWithMembers | null;
    }
  >;
};

type ProjectWithBoard = Project & {
  members: ProjectMemberWithUser[];
  taskGroups: TaskGroupWithMembers[];
  columns: ColumnWithTasks[];
};

type AnnouncementWithDetails = Announcement & {
  author?: Pick<User, "id" | "email" | "name"> | null;
  recipients: Array<AnnouncementRecipient & { member: ProjectMemberWithUser }>;
};

export function userDto(user: Pick<User, "id" | "email" | "name">) {
  return {
    id: user.id,
    email: user.email,
    name: user.name
  };
}

export function projectDto(project: Pick<Project, "id" | "name" | "description" | "version" | "createdAt" | "updatedAt">) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    version: project.version,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

export function taskGroupDto(group: TaskGroupWithMembers) {
  return {
    id: group.id,
    projectId: group.projectId,
    name: group.name,
    members: group.members.map((item) => memberDto(item.member)),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt
  };
}

export function taskDto(
  task: Task & {
    creator: Pick<User, "id" | "name" | "email">;
    assignee?: Pick<User, "id" | "name" | "email"> | null;
    assigneeGroup?: TaskGroupWithMembers | null;
  }
) {
  return {
    id: task.id,
    projectId: task.projectId,
    columnId: task.columnId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    position: Number(task.position),
    version: task.version,
    creator: userDto(task.creator),
    assignee: task.assignee ? userDto(task.assignee) : null,
    assigneeGroup: task.assigneeGroup ? taskGroupDto(task.assigneeGroup) : null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

export function columnDto(column: ColumnWithTasks) {
  return {
    id: column.id,
    projectId: column.projectId,
    title: column.title,
    description: column.description,
    position: column.position,
    version: column.version,
    createdAt: column.createdAt,
    updatedAt: column.updatedAt,
    tasks: column.tasks.map(taskDto)
  };
}

export function memberDto(member: ProjectMemberWithUser) {
  return {
    id: member.id,
    role: member.role,
    user: userDto(member.user),
    createdAt: member.createdAt
  };
}

export function boardDto(project: ProjectWithBoard) {
  return {
    ...projectDto(project),
    members: project.members.map(memberDto),
    groups: project.taskGroups.map(taskGroupDto),
    columns: project.columns.map(columnDto)
  };
}

export function eventDto(
  event: TaskEvent & {
    actor?: Pick<User, "id" | "email" | "name"> | null;
  }
) {
  return {
    id: event.id,
    projectId: event.projectId,
    taskId: event.taskId,
    actorId: event.actorId,
    actor: event.actor ? userDto(event.actor) : null,
    type: event.type,
    payload: event.payload,
    createdAt: event.createdAt
  };
}

export function announcementDto(announcement: AnnouncementWithDetails, viewerMemberId?: string | null) {
  const viewerRecipient = viewerMemberId
    ? announcement.recipients.find((recipient) => recipient.memberId === viewerMemberId)
    : null;

  return {
    id: announcement.id,
    projectId: announcement.projectId,
    authorId: announcement.authorId,
    author: announcement.author ? userDto(announcement.author) : null,
    title: announcement.title,
    body: announcement.body,
    priority: announcement.priority,
    expiresAt: announcement.expiresAt,
    recipients: announcement.recipients.map((recipient) => ({
      id: recipient.id,
      readAt: recipient.readAt,
      acknowledgedAt: recipient.acknowledgedAt,
      archivedAt: recipient.archivedAt,
      member: memberDto(recipient.member)
    })),
    readAt: viewerRecipient?.readAt ?? null,
    acknowledgedAt: viewerRecipient?.acknowledgedAt ?? null,
    archivedAt: viewerRecipient?.archivedAt ?? null,
    createdAt: announcement.createdAt
  };
}
