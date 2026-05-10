import type { Announcement, AnnouncementPriority, AuthState, Board, BoardColumn, Project, ProjectMember, ProjectMetrics, ProjectRole, SyncEvent, Task, TaskAssignmentInput, TaskGroup, TaskPriority, User } from "./types";

const TOKEN_KEY = "diplom-kanban-token";
const USER_KEY = "diplom-kanban-user";

export function loadAuth(): AuthState | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const userRaw = localStorage.getItem(USER_KEY);
  if (!token || !userRaw) {
    return null;
  }

  try {
    return { token, user: JSON.parse(userRaw) as User };
  } catch {
    clearAuth();
    return null;
  }
}

export function saveAuth(auth: AuthState) {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function request<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed");
  }

  return payload as T;
}

export const api = {
  async register(input: { email: string; name: string; password: string }) {
    return request<{ token: string; user: User }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async login(input: { email: string; password: string }) {
    return request<{ token: string; user: User }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async projects(token: string) {
    return request<{ projects: Project[] }>("/api/projects", { token });
  },

  async createProject(token: string, input: { name: string; description: string }) {
    return request<{ project: Project }>("/api/projects", {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async users(token: string) {
    return request<{ users: User[] }>("/api/users", { token });
  },

  async createUser(token: string, input: { email: string; name: string; password: string; projectIds: string[]; role?: ProjectRole }) {
    return request<{ user: User; member: ProjectMember | null; members: ProjectMember[] }>("/api/users", {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async deleteUser(token: string, userId: string) {
    return request<void>(`/api/users/${userId}`, {
      token,
      method: "DELETE"
    });
  },

  async addUserToProjects(token: string, userId: string, input: { projectIds: string[]; role: ProjectRole }) {
    return request<{ members: ProjectMember[] }>(`/api/users/${userId}/projects`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async deleteProject(token: string, projectId: string) {
    return request<void>(`/api/projects/${projectId}`, {
      token,
      method: "DELETE"
    });
  },

  async availableUsers(token: string, projectId: string) {
    return request<{ users: User[] }>(`/api/projects/${projectId}/available-users`, { token });
  },

  async board(token: string, projectId: string) {
    return request<{ board: Board }>(`/api/projects/${projectId}/board`, { token });
  },

  async events(token: string, projectId: string) {
    return request<{ events: SyncEvent[] }>(`/api/projects/${projectId}/events?limit=20`, { token });
  },

  async metrics(token: string, projectId: string) {
    return request<{ metrics: ProjectMetrics }>(`/api/projects/${projectId}/metrics`, { token });
  },

  async announcements(token: string, projectId: string) {
    return request<{ announcements: Announcement[]; unreadCount: number }>(`/api/projects/${projectId}/announcements?limit=50`, { token });
  },

  async createAnnouncement(token: string, projectId: string, input: { title: string; body: string; priority: AnnouncementPriority; expiresAt?: string | null; recipientMemberIds: string[]; recipientRoles: ProjectRole[] }) {
    return request<{ announcement: Announcement }>(`/api/projects/${projectId}/announcements`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async markAnnouncementsRead(token: string, projectId: string) {
    return request<void>(`/api/projects/${projectId}/announcements/read`, {
      token,
      method: "POST"
    });
  },

  async markAnnouncementRead(token: string, projectId: string, announcementId: string) {
    return request<void>(`/api/projects/${projectId}/announcements/${announcementId}/read`, {
      token,
      method: "POST"
    });
  },

  async acknowledgeAnnouncement(token: string, projectId: string, announcementId: string) {
    return request<void>(`/api/projects/${projectId}/announcements/${announcementId}/acknowledge`, {
      token,
      method: "POST"
    });
  },

  async archiveAnnouncement(token: string, projectId: string, announcementId: string) {
    return request<void>(`/api/projects/${projectId}/announcements/${announcementId}/archive`, {
      token,
      method: "POST"
    });
  },

  async createColumn(token: string, projectId: string, input: { title: string; description: string }) {
    return request<{ column: BoardColumn }>(`/api/projects/${projectId}/columns`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async updateColumn(token: string, columnId: string, input: { title?: string; description?: string }) {
    return request<{ column: BoardColumn }>(`/api/columns/${columnId}`, {
      token,
      method: "PATCH",
      body: JSON.stringify(input)
    });
  },

  async deleteColumn(token: string, columnId: string) {
    return request<void>(`/api/columns/${columnId}`, {
      token,
      method: "DELETE"
    });
  },

  async createTask(
    token: string,
    projectId: string,
    input: { columnId: string; title: string; description: string; priority: TaskPriority } & TaskAssignmentInput
  ) {
    return request<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async updateTask(
    token: string,
    taskId: string,
    input: Partial<Pick<Task, "title" | "description" | "priority">> & TaskAssignmentInput & { clientVersion?: number }
  ) {
    return request<{ task: Task; conflictResolved: boolean }>(`/api/tasks/${taskId}`, {
      token,
      method: "PATCH",
      body: JSON.stringify(input)
    });
  },

  async moveTask(
    token: string,
    taskId: string,
    input: { columnId: string; beforeTaskId?: string | null; afterTaskId?: string | null; clientVersion?: number }
  ) {
    return request<{ task: Task; conflictResolved: boolean }>(`/api/tasks/${taskId}/move`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async completeTask(token: string, taskId: string) {
    return request<{ task: Task }>(`/api/tasks/${taskId}/complete`, {
      token,
      method: "POST"
    });
  },

  async requestTaskCompletion(token: string, taskId: string) {
    return request<{ task: Task; announcement: Announcement | null }>(`/api/tasks/${taskId}/request-completion`, {
      token,
      method: "POST"
    });
  },

  async moveCompletedTask(
    token: string,
    taskId: string,
    input: { beforeTaskId?: string | null; afterTaskId?: string | null }
  ) {
    return request<{ task: Task }>(`/api/tasks/${taskId}/roadmap-move`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async deleteTask(token: string, taskId: string) {
    return request<void>(`/api/tasks/${taskId}`, {
      token,
      method: "DELETE"
    });
  },

  async addMember(
    token: string,
    projectId: string,
    input: { userId: string; role: ProjectRole }
  ) {
    return request<{ member: ProjectMember }>(`/api/projects/${projectId}/members`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async updateMember(token: string, projectId: string, memberId: string, input: { role: ProjectRole }) {
    return request<{ member: ProjectMember }>(`/api/projects/${projectId}/members/${memberId}`, {
      token,
      method: "PATCH",
      body: JSON.stringify(input)
    });
  },

  async removeMember(token: string, projectId: string, memberId: string) {
    return request<void>(`/api/projects/${projectId}/members/${memberId}`, {
      token,
      method: "DELETE"
    });
  },

  async createGroup(token: string, projectId: string, input: { name: string; memberIds: string[] }) {
    return request<{ group: TaskGroup }>(`/api/projects/${projectId}/groups`, {
      token,
      method: "POST",
      body: JSON.stringify(input)
    });
  },

  async updateGroup(token: string, projectId: string, groupId: string, input: { name?: string; memberIds?: string[] }) {
    return request<{ group: TaskGroup }>(`/api/projects/${projectId}/groups/${groupId}`, {
      token,
      method: "PATCH",
      body: JSON.stringify(input)
    });
  },

  async deleteGroup(token: string, projectId: string, groupId: string) {
    return request<void>(`/api/projects/${projectId}/groups/${groupId}`, {
      token,
      method: "DELETE"
    });
  }
};
