export type User = {
  id: string;
  email: string;
  name: string;
};

export type ProjectRole = "ADMIN" | "MEMBER";

export type Project = {
  id: string;
  name: string;
  description: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  role?: ProjectRole;
};

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH";
export type AnnouncementPriority = "NORMAL" | "IMPORTANT" | "URGENT";

export type ProjectMember = {
  id: string;
  role: ProjectRole;
  user: User;
  createdAt?: string;
};

export type TaskGroup = {
  id: string;
  projectId: string;
  name: string;
  members: ProjectMember[];
  createdAt: string;
  updatedAt: string;
};

export type Task = {
  id: string;
  projectId: string;
  columnId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  position: number;
  version: number;
  isCompleted: boolean;
  completedAt: string | null;
  completedPosition: number | null;
  completionRequestedAt: string | null;
  creator: User;
  assignee: User | null;
  completedBy: User | null;
  completionRequestedBy: User | null;
  assigneeGroup: TaskGroup | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardColumn = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  position: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  tasks: Task[];
  completedTasks: Task[];
};

export type Board = Project & {
  members: ProjectMember[];
  groups: TaskGroup[];
  columns: BoardColumn[];
};

export type TaskAssignmentInput = {
  assigneeId?: string | null;
  assigneeGroupId?: string | null;
};

export type SyncEvent = {
  id: string;
  projectId: string;
  taskId: string | null;
  actorId: string | null;
  actor: User | null;
  type: string;
  payload: unknown;
  createdAt: string;
  serverTime?: number;
};

export type ProjectMetrics = {
  projectId: string;
  eventsCount: number;
  lastEventAt: string | null;
  recentEventTypes: string[];
};

export type Announcement = {
  id: string;
  projectId: string;
  authorId: string | null;
  author: User | null;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  expiresAt: string | null;
  recipients: Array<{
    id: string;
    readAt: string | null;
    acknowledgedAt: string | null;
    archivedAt: string | null;
    member: ProjectMember;
  }>;
  readAt: string | null;
  acknowledgedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type AuthState = {
  token: string;
  user: User;
};
