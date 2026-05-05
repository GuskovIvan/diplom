import React from "react";
import { createRoot } from "react-dom/client";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent
} from "@dnd-kit/core";
import { io, type Socket } from "socket.io-client";
import { api, clearAuth, loadAuth, saveAuth } from "./api";
import type {
  Announcement,
  AnnouncementPriority,
  AuthState,
  Board,
  BoardColumn,
  Project,
  ProjectMember,
  ProjectMetrics,
  ProjectRole,
  SyncEvent,
  Task,
  TaskAssignmentInput,
  TaskGroup,
  TaskPriority,
  User
} from "./types";
import "./styles.css";

type ConnectionState = "offline" | "connecting" | "online";
type WorkspaceView = "board" | "roadmap" | "announcements" | "audit";
type RoadmapStatus = "upcoming" | "active" | "inactive" | "completed";

type MemberCreateInput = {
  email: string;
  name?: string;
  password?: string;
  role: Exclude<ProjectRole, "OWNER">;
};

type TaskCreateInput = {
  title: string;
  description: string;
  priority: TaskPriority;
} & TaskAssignmentInput;

type DropData =
  | { type: "column"; columnId: string }
  | { type: "task"; columnId: string; taskId: string };

const priorityLabel: Record<TaskPriority, string> = {
  LOW: "низкий",
  MEDIUM: "средний",
  HIGH: "высокий"
};

const priorityValues: TaskPriority[] = ["LOW", "MEDIUM", "HIGH"];

const roleLabel: Record<ProjectRole, string> = {
  OWNER: "владелец",
  ADMIN: "администратор",
  MEMBER: "участник"
};

const announcementPriorityLabel: Record<AnnouncementPriority, string> = {
  NORMAL: "обычное",
  IMPORTANT: "важное",
  URGENT: "срочное"
};

const announcementPriorityValues: AnnouncementPriority[] = ["NORMAL", "IMPORTANT", "URGENT"];

const roadmapStatusLabel: Record<RoadmapStatus, string> = {
  upcoming: "предстоящая",
  active: "активная",
  inactive: "неактивная",
  completed: "завершена"
};

const eventLabel: Record<string, string> = {
  PROJECT_CREATED: "проект создан",
  MEMBER_ADDED: "участник добавлен",
  MEMBER_UPDATED: "роль участника изменена",
  MEMBER_REMOVED: "участник удален",
  GROUP_CREATED: "группа создана",
  GROUP_UPDATED: "группа изменена",
  GROUP_DELETED: "группа удалена",
  COLUMN_CREATED: "колонка создана",
  COLUMN_UPDATED: "колонка изменена",
  COLUMN_DELETED: "колонка удалена",
  TASK_CREATED: "задача создана",
  TASK_UPDATED: "задача изменена",
  TASK_MOVED: "задача перемещена",
  TASK_DELETED: "задача удалена"
};

function safeError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function isAdminRole(role: ProjectRole | null | undefined): role is "OWNER" | "ADMIN" {
  return role === "OWNER" || role === "ADMIN";
}

function allowedMemberTargets(members: ProjectMember[], currentRole: ProjectRole | null) {
  if (currentRole === "OWNER") {
    return members.filter((member) => member.role !== "OWNER");
  }

  if (currentRole === "ADMIN") {
    return members.filter((member) => member.role === "MEMBER");
  }

  return [];
}

function allowedGroupTargets(groups: TaskGroup[], currentRole: ProjectRole | null) {
  if (currentRole === "OWNER") {
    return groups.filter((group) => group.members.length > 0 && group.members.every((member) => member.role !== "OWNER"));
  }

  if (currentRole === "ADMIN") {
    return groups.filter((group) => group.members.length > 0 && group.members.every((member) => member.role === "MEMBER"));
  }

  return [];
}

function assignmentValue(task: Task) {
  if (task.assigneeGroup) {
    return `group:${task.assigneeGroup.id}`;
  }

  if (task.assignee) {
    return `user:${task.assignee.id}`;
  }

  return "";
}

function assignmentInputFromValue(value: string): TaskAssignmentInput {
  if (value.startsWith("group:")) {
    return { assigneeId: null, assigneeGroupId: value.slice(6) };
  }

  if (value.startsWith("user:")) {
    return { assigneeId: value.slice(5), assigneeGroupId: null };
  }

  return { assigneeId: null, assigneeGroupId: null };
}

function assignmentLabel(task: Task) {
  if (task.assigneeGroup) {
    return `Группа: ${task.assigneeGroup.name}`;
  }

  return task.assignee?.name ?? "не назначен";
}

function taskIsAddressedToUser(task: Task, userId: string) {
  return task.assignee?.id === userId || Boolean(task.assigneeGroup?.members.some((member) => member.user.id === userId));
}

function memberNames(members: ProjectMember[]) {
  return members.map((member) => member.user.name).join(", ");
}

function getTaskTitleFromEvent(event: SyncEvent) {
  if (!event.payload || typeof event.payload !== "object") {
    return null;
  }

  const payload = event.payload as {
    task?: { title?: unknown };
    title?: unknown;
    previousTask?: { title?: unknown };
  };

  if (typeof payload.task?.title === "string") {
    return payload.task.title;
  }

  if (typeof payload.title === "string") {
    return payload.title;
  }

  if (typeof payload.previousTask?.title === "string") {
    return payload.previousTask.title;
  }

  return null;
}

function getColumnTitleById(columns: BoardColumn[], columnId: string | null) {
  if (!columnId) {
    return null;
  }

  return columns.find((column) => column.id === columnId)?.title ?? null;
}

function getTaskMoveFromEvent(event: SyncEvent, columns: BoardColumn[]) {
  if (event.type !== "TASK_MOVED" || !event.payload || typeof event.payload !== "object") {
    return null;
  }

  const payload = event.payload as {
    previous?: { columnId?: unknown; columnTitle?: unknown };
    current?: { columnId?: unknown; columnTitle?: unknown };
    task?: { columnId?: unknown };
  };

  const previousColumnId = typeof payload.previous?.columnId === "string" ? payload.previous.columnId : null;
  const currentColumnId = typeof payload.current?.columnId === "string"
    ? payload.current.columnId
    : typeof payload.task?.columnId === "string"
      ? payload.task.columnId
      : null;

  const previousTitle = typeof payload.previous?.columnTitle === "string"
    ? payload.previous.columnTitle
    : getColumnTitleById(columns, previousColumnId);
  const currentTitle = typeof payload.current?.columnTitle === "string"
    ? payload.current.columnTitle
    : getColumnTitleById(columns, currentColumnId);

  if (!previousTitle || !currentTitle) {
    return null;
  }

  return `${previousTitle} -> ${currentTitle}`;
}

function getConflictLabel(event: SyncEvent) {
  if (!event.payload || typeof event.payload !== "object") {
    return null;
  }

  const payload = event.payload as {
    conflict?: {
      resolved?: unknown;
      strategy?: unknown;
      clientVersion?: unknown;
      previousServerVersion?: unknown;
    };
  };

  if (!payload.conflict?.resolved) {
    return null;
  }

  const strategy = typeof payload.conflict.strategy === "string" ? payload.conflict.strategy : "LAST_WRITE_WINS";
  const clientVersion = typeof payload.conflict.clientVersion === "number" ? payload.conflict.clientVersion : null;
  const previousServerVersion = typeof payload.conflict.previousServerVersion === "number" ? payload.conflict.previousServerVersion : null;

  if (clientVersion !== null && previousServerVersion !== null) {
    return `Конфликт версий: клиент v${clientVersion}, сервер v${previousServerVersion}, стратегия ${strategy}`;
  }

  return `Конфликт разрешен по стратегии ${strategy}`;
}

function actorLabel(event: SyncEvent) {
  return event.actor ? `${event.actor.name} (${event.actor.email})` : "Система";
}

function formatEventType(type: string) {
  return eventLabel[type] ?? type.replaceAll("_", " ").toLowerCase();
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function findTask(board: Board | null, taskId: string) {
  for (const column of board?.columns ?? []) {
    const task = column.tasks.find((item) => item.id === taskId);
    if (task) {
      return task;
    }
  }

  return null;
}

function optimisticMove(board: Board, taskId: string, columnId: string, beforeTaskId?: string | null) {
  let movedTask: Task | null = null;
  const columnsWithoutTask = board.columns.map((column) => ({
    ...column,
    tasks: column.tasks.filter((task) => {
      if (task.id !== taskId) {
        return true;
      }

      movedTask = { ...task, columnId };
      return false;
    })
  }));

  if (!movedTask) {
    return board;
  }

  const nextColumns = columnsWithoutTask.map((column) => {
    if (column.id !== columnId) {
      return column;
    }

    const tasks = [...column.tasks];
    const insertIndex = beforeTaskId ? tasks.findIndex((task) => task.id === beforeTaskId) : -1;
    if (insertIndex >= 0) {
      tasks.splice(insertIndex, 0, movedTask);
    } else {
      tasks.push(movedTask);
    }

    return { ...column, tasks };
  });

  return { ...board, columns: nextColumns };
}

function sortColumns(columns: BoardColumn[]) {
  return [...columns].sort((left, right) => left.position - right.position || left.title.localeCompare(right.title, "ru"));
}

function getRoadmapStatus(task: Task, columns: BoardColumn[]): RoadmapStatus {
  const orderedColumns = sortColumns(columns);
  const columnIndex = orderedColumns.findIndex((column) => column.id === task.columnId);

  if (columnIndex === -1) {
    return task.assignee || task.assigneeGroup ? "active" : "inactive";
  }

  if (columnIndex === orderedColumns.length - 1) {
    return "completed";
  }

  if (columnIndex === 0) {
    return "upcoming";
  }

  return task.assignee || task.assigneeGroup ? "active" : "inactive";
}

function getRoadmapStats(board: Board | null) {
  const stats: Record<RoadmapStatus, number> = {
    upcoming: 0,
    active: 0,
    inactive: 0,
    completed: 0
  };

  const columns = board ? sortColumns(board.columns) : [];
  for (const column of columns) {
    for (const task of column.tasks) {
      stats[getRoadmapStatus(task, columns)] += 1;
    }
  }

  return stats;
}

function AuthScreen({ onAuth }: { onAuth: (auth: AuthState) => void }) {
  const [mode, setMode] = React.useState<"login" | "register">("login");
  const [email, setEmail] = React.useState("demo@example.com");
  const [name, setName] = React.useState("Демо-пользователь");
  const [password, setPassword] = React.useState("demo12345");
  const [error, setError] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = mode === "login"
        ? await api.login({ email, password })
        : await api.register({ email, name, password });

      onAuth({ token: response.token, user: response.user });
    } catch (submitError) {
      setError(safeError(submitError, "Ошибка авторизации"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-copy">
          <p className="eyebrow">REST API + WebSocket + PostgreSQL</p>
          <h1>Командная Kanban-доска с синхронизацией в реальном времени</h1>
          <p>Управляйте задачами, перетаскивайте карточки между статусами и наблюдайте события других участников без обновления страницы.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="switch-row">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Вход</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Регистрация</button>
          </div>

          {mode === "register" ? (
            <label>
              Имя
              <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} required />
            </label>
          ) : null}

          <label>
            Электронная почта
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>

          <label>
            Пароль
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={8} required />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" disabled={submitting}>
            {submitting ? "Подключаем..." : mode === "login" ? "Войти" : "Создать аккаунт"}
          </button>

          <p className="hint">Для демо используйте демо-аккаунт: demo@example.com / demo12345.</p>
        </form>
      </section>

      <img
        className="auth-image"
        alt="Командная работа за ноутбуками"
        src="https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1100&q=80"
      />
    </main>
  );
}

type AppTopbarProps = {
  user: User;
  view: WorkspaceView;
  unreadAnnouncements: number;
  onViewChange: (view: WorkspaceView) => void;
  onLogout: () => void;
};

function AppTopbar({ user, view, unreadAnnouncements, onViewChange, onLogout }: AppTopbarProps) {
  return (
    <header className="app-topbar">
      <div className="brand-mark">
        <span>К</span>
      </div>

      <div className="topbar-title">
        <strong>Канбан-платформа</strong>
        <span>REST API + WebSocket</span>
      </div>

      <nav className="topbar-nav" aria-label="Разделы">
        <button className={view === "board" ? "active" : ""} onClick={() => onViewChange("board")}>Доска</button>
        <button className={view === "roadmap" ? "active" : ""} onClick={() => onViewChange("roadmap")}>Roadmap</button>
        <button className={`nav-button-with-badge ${view === "announcements" ? "active" : ""}`} onClick={() => onViewChange("announcements")}>
          <span>Объявления</span>
          {unreadAnnouncements > 0 ? <span className="nav-badge">{unreadAnnouncements > 99 ? "99+" : unreadAnnouncements}</span> : null}
        </button>
        <button className={view === "audit" ? "active" : ""} onClick={() => onViewChange("audit")}>Аудит</button>
      </nav>

      <div className="topbar-actions">
        <span>{user.name}</span>
        <button className="ghost-button" onClick={onLogout}>Выйти</button>
      </div>
    </header>
  );
}

type MembersPanelProps = {
  members: ProjectMember[];
  currentRole: ProjectRole | null;
  currentUserId: string;
  onAddMember: (input: MemberCreateInput) => Promise<void>;
  onChangeRole: (member: ProjectMember, role: Exclude<ProjectRole, "OWNER">) => Promise<void>;
  onRemoveMember: (member: ProjectMember) => Promise<void>;
};

function MembersPanel({ members, currentRole, currentUserId, onAddMember, onChangeRole, onRemoveMember }: MembersPanelProps) {
  const [email, setEmail] = React.useState("");
  const [name, setName] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Exclude<ProjectRole, "OWNER">>("MEMBER");
  const [submitting, setSubmitting] = React.useState(false);

  const canManageMembers = isAdminRole(currentRole);
  const isOwner = currentRole === "OWNER";

  React.useEffect(() => {
    if (!isOwner && role === "ADMIN") {
      setRole("MEMBER");
    }
  }, [isOwner, role]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !canManageMembers) {
      return;
    }

    setSubmitting(true);
    try {
      await onAddMember({
        email: email.trim(),
        name: name.trim() || undefined,
        password: password || undefined,
        role
      });
      setEmail("");
      setName("");
      setPassword("");
      setRole("MEMBER");
    } catch {
      // Ошибка показывается в общем notice.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="members-panel">
      <div className="panel-heading">
        <p className="eyebrow">Команда</p>
        <h2>{canManageMembers ? "Добавить пользователя" : "Участники проекта"}</h2>
      </div>

      <div className="member-list">
        {members.map((member) => {
          const canChangeRole = isOwner && member.role !== "OWNER" && member.user.id !== currentUserId;
          const canRemove = member.role !== "OWNER"
            && member.user.id !== currentUserId
            && (isOwner || (currentRole === "ADMIN" && member.role === "MEMBER"));

          return (
            <article className="member-row" key={member.id}>
              <div className="avatar small">{getInitials(member.user.name) || "U"}</div>
              <div>
                <strong>{member.user.name}</strong>
                <span>{member.user.email}</span>
              </div>

              {canChangeRole ? (
                <select value={member.role} onChange={(event) => { void onChangeRole(member, event.target.value as Exclude<ProjectRole, "OWNER">); }}>
                  <option value="MEMBER">участник</option>
                  <option value="ADMIN">администратор</option>
                </select>
              ) : (
                <small>{roleLabel[member.role]}</small>
              )}

              {canRemove ? (
                <button className="ghost-button" onClick={() => { void onRemoveMember(member); }}>Удалить</button>
              ) : null}
            </article>
          );
        })}
      </div>

      {canManageMembers ? (
        <form className="member-form" onSubmit={handleSubmit}>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="email пользователя" />
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="имя пользователя" />
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={8} placeholder="пароль для нового аккаунта" />
          <select value={role} onChange={(event) => setRole(event.target.value as Exclude<ProjectRole, "OWNER">)}>
            <option value="MEMBER">участник</option>
            {isOwner ? <option value="ADMIN">администратор</option> : null}
          </select>
          <button disabled={submitting}>{submitting ? "Добавляем..." : "Добавить"}</button>
          <p className="hint">Если аккаунта нет, он будет создан с этим именем и паролем. Если пароль оставить пустым, сервер создаст уникальный временный пароль.</p>
        </form>
      ) : (
        <p className="hint">Состав команды меняют владелец и администраторы.</p>
      )}
    </aside>
  );
}

type GroupsPanelProps = {
  groups: TaskGroup[];
  members: ProjectMember[];
  currentRole: ProjectRole | null;
  onCreateGroup: (input: { name: string; memberIds: string[] }) => Promise<void>;
  onUpdateGroup: (group: TaskGroup, input: { name?: string; memberIds?: string[] }) => Promise<void>;
  onDeleteGroup: (group: TaskGroup) => Promise<void>;
};

function GroupsPanel({ groups, members, currentRole, onCreateGroup, onUpdateGroup, onDeleteGroup }: GroupsPanelProps) {
  const [name, setName] = React.useState("");
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const canManageGroups = isAdminRole(currentRole);
  const editingGroup = groups.find((group) => group.id === editingGroupId) ?? null;

  const resetForm = () => {
    setName("");
    setSelectedIds([]);
    setEditingGroupId(null);
  };

  const toggleMember = (memberId: string) => {
    setSelectedIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  };

  const canEditGroup = (group: TaskGroup) => currentRole === "OWNER"
    || (currentRole === "ADMIN" && group.members.every((member) => member.role === "MEMBER"));

  const startEditing = (group: TaskGroup) => {
    setEditingGroupId(group.id);
    setName(group.name);
    setSelectedIds(group.members.map((member) => member.id).filter((memberId) => members.some((member) => member.id === memberId)));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageGroups || !name.trim() || selectedIds.length === 0) {
      return;
    }

    setSubmitting(true);
    try {
      if (editingGroup) {
        await onUpdateGroup(editingGroup, { name: name.trim(), memberIds: selectedIds });
      } else {
        await onCreateGroup({ name: name.trim(), memberIds: selectedIds });
      }
      resetForm();
    } catch {
      // Ошибка показывается в общем notice.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="members-panel groups-panel">
      <div className="panel-heading">
        <p className="eyebrow">Адресаты</p>
        <h2>Группы участников</h2>
      </div>

      <div className="member-list">
        {groups.length === 0 ? <p className="hint">Групп пока нет.</p> : null}

        {groups.map((group) => {
          const editable = canEditGroup(group);
          return (
            <article className="member-row group-row" key={group.id}>
              <div>
                <strong>{group.name}</strong>
                <span>{memberNames(group.members) || "без участников"}</span>
              </div>

              {canManageGroups && editable ? (
                <div className="group-actions">
                  <button type="button" className="ghost-button" onClick={() => startEditing(group)}>Изменить</button>
                  <button type="button" className="ghost-button" onClick={() => { void onDeleteGroup(group); }}>Удалить</button>
                </div>
              ) : null}

              {canManageGroups && !editable ? <small>только владелец</small> : null}
            </article>
          );
        })}
      </div>

      {canManageGroups ? (
        <form className="member-form" onSubmit={handleSubmit}>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Название группы" />

          <div className="group-member-options">
            {members.length === 0 ? <p className="hint">Нет доступных участников для группы.</p> : null}
            {members.map((member) => (
              <label className="checkbox-row" key={member.id}>
                <input type="checkbox" checked={selectedIds.includes(member.id)} onChange={() => toggleMember(member.id)} />
                <span>{member.user.name}</span>
              </label>
            ))}
          </div>

          <button disabled={submitting || selectedIds.length === 0}>
            {submitting ? "Сохраняем..." : editingGroup ? "Сохранить группу" : "Создать группу"}
          </button>

          {editingGroup ? (
            <button type="button" className="ghost-button" onClick={resetForm}>Отменить</button>
          ) : null}

          <p className="hint">Владелец может включать администраторов и участников, администратор - только участников.</p>
        </form>
      ) : (
        <p className="hint">Группы создают владелец и администраторы проекта.</p>
      )}
    </aside>
  );
}

type ProjectRailProps = {
  projects: Project[];
  activeProjectId: string | null;
  onSelect: (projectId: string) => void;
  onCreate: (input: { name: string; description: string }) => Promise<void>;
  user: User;
  onLogout: () => void;
  members: ProjectMember[];
  groups: TaskGroup[];
  currentRole: ProjectRole | null;
  canCreateProjects: boolean;
  onAddMember: (input: MemberCreateInput) => Promise<void>;
  onChangeRole: (member: ProjectMember, role: Exclude<ProjectRole, "OWNER">) => Promise<void>;
  onRemoveMember: (member: ProjectMember) => Promise<void>;
  onCreateGroup: (input: { name: string; memberIds: string[] }) => Promise<void>;
  onUpdateGroup: (group: TaskGroup, input: { name?: string; memberIds?: string[] }) => Promise<void>;
  onDeleteGroup: (group: TaskGroup) => Promise<void>;
};

function ProjectRail({
  projects,
  activeProjectId,
  onSelect,
  onCreate,
  user,
  onLogout,
  members,
  groups,
  currentRole,
  canCreateProjects,
  onAddMember,
  onChangeRole,
  onRemoveMember,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup
}: ProjectRailProps) {
  const [projectName, setProjectName] = React.useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectName.trim() || !canCreateProjects) {
      return;
    }

    try {
      await onCreate({ name: projectName.trim(), description: "Новый проект для совместной работы." });
      setProjectName("");
    } catch {
      // Ошибка показывается в общем notice.
    }
  };

  return (
    <aside className="project-rail">
      <div className="rail-profile">
        <div className="avatar">{getInitials(user.name) || "U"}</div>
        <div>
          <p className="eyebrow">Аккаунт</p>
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
      </div>

      <MembersPanel
        members={members}
        currentRole={currentRole}
        currentUserId={user.id}
        onAddMember={onAddMember}
        onChangeRole={onChangeRole}
        onRemoveMember={onRemoveMember}
      />

      <GroupsPanel
        groups={groups}
        members={allowedMemberTargets(members, currentRole)}
        currentRole={currentRole}
        onCreateGroup={onCreateGroup}
        onUpdateGroup={onUpdateGroup}
        onDeleteGroup={onDeleteGroup}
      />

      <div className="rail-title">
        <span>Пространства</span>
        <small>{projects.length}</small>
      </div>

      <nav className="project-list" aria-label="Проекты">
        {projects.map((project) => (
          <button className={project.id === activeProjectId ? "selected" : ""} key={project.id} onClick={() => onSelect(project.id)}>
            <span>{project.name}</span>
            <small>{roleLabel[project.role ?? "MEMBER"]}</small>
          </button>
        ))}
      </nav>

      {canCreateProjects ? (
        <form className="compact-form" onSubmit={handleSubmit}>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Новый проект" />
          <button>Создать</button>
        </form>
      ) : (
        <p className="hint">Пространства создают владелец и администраторы.</p>
      )}

      <button className="ghost-button" onClick={onLogout}>Выйти</button>
    </aside>
  );
}

function ConnectionBar({ connection, latency, users }: { connection: ConnectionState; latency: number | null; users: unknown[] }) {
  return (
    <div className="connection-bar">
      <span className={`status-dot ${connection}`} />
      <span>{connection === "online" ? "WebSocket подключен" : connection === "connecting" ? "Подключение..." : "Офлайн"}</span>
      <span>{latency === null ? "задержка: нет данных" : `задержка: ${latency} мс`}</span>
      <span>участники: {users.length || 1}</span>
    </div>
  );
}

type TaskCardProps = {
  task: Task;
  members: ProjectMember[];
  groups: TaskGroup[];
  canEdit: boolean;
  canDelete: boolean;
  canMove: boolean;
  canAssign: boolean;
  onDelete: (task: Task) => Promise<void>;
  onQuickEdit: (task: Task) => Promise<void>;
  onAssign: (task: Task, input: TaskAssignmentInput) => Promise<void>;
};

function TaskCard({ task, members, groups, canEdit, canDelete, canMove, canAssign, onDelete, onQuickEdit, onAssign }: TaskCardProps) {
  const drop = useDroppable({ id: `task-drop:${task.id}`, data: { type: "task", columnId: task.columnId, taskId: task.id } });
  const drag = useDraggable({ id: task.id, disabled: !canMove, data: { type: "task", task } });

  const setNodeRef = React.useCallback((node: HTMLElement | null) => {
    drop.setNodeRef(node);
    drag.setNodeRef(node);
  }, [drop, drag]);

  return (
    <article ref={setNodeRef} className={`task-card ${drop.isOver ? "drop-before" : ""} ${drag.isDragging ? "is-dragging" : ""} ${canMove ? "" : "locked"}`}>
      <div className="task-drag-surface" {...drag.listeners} {...drag.attributes}>
        <div className="task-topline">
          <span className={`priority ${task.priority.toLowerCase()}`}>{priorityLabel[task.priority]}</span>
          <span>v{task.version}</span>
        </div>

        <h3>{task.title}</h3>
        {task.description ? <p>{task.description}</p> : null}

        <div className="task-assignee">
          <span>Адресат</span>
          {canAssign ? (
            <select
              value={assignmentValue(task)}
              onChange={(event) => { void onAssign(task, assignmentInputFromValue(event.target.value)); }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <option value="">Не назначен</option>
              {members.length > 0 ? (
                <optgroup label="Участники">
                  {members.map((member) => (
                    <option value={`user:${member.user.id}`} key={member.user.id}>{member.user.name}</option>
                  ))}
                </optgroup>
              ) : null}
              {groups.length > 0 ? (
                <optgroup label="Группы">
                  {groups.map((group) => (
                    <option value={`group:${group.id}`} key={group.id}>{group.name}</option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          ) : (
            <strong>{assignmentLabel(task)}</strong>
          )}
        </div>

        <div className="task-creator">
          <span>Создал/а</span>
          <strong>{task.creator.name}</strong>
          <small>{task.creator.email}</small>
        </div>
      </div>

      {canEdit || canDelete ? (
        <div className="task-actions">
          {canEdit ? (
            <button onPointerDown={(event) => event.stopPropagation()} onClick={() => { void onQuickEdit(task); }}>Изменить</button>
          ) : null}
          {canDelete ? (
            <button onPointerDown={(event) => event.stopPropagation()} onClick={() => { void onDelete(task); }}>Удалить</button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function TaskDragPreview({ task }: { task: Task }) {
  return (
    <article className="task-card drag-overlay">
      <div className="task-topline">
        <span className={`priority ${task.priority.toLowerCase()}`}>{priorityLabel[task.priority]}</span>
        <span>v{task.version}</span>
      </div>
      <h3>{task.title}</h3>
      {task.description ? <p>{task.description}</p> : null}
      <div className="task-assignee">
        <span>Адресат</span>
        <strong>{assignmentLabel(task)}</strong>
      </div>
    </article>
  );
}

function TaskCreateForm({
  column,
  members,
  groups,
  onCreate
}: {
  column: BoardColumn;
  members: ProjectMember[];
  groups: TaskGroup[];
  onCreate: (input: TaskCreateInput) => Promise<void>;
}) {
  const [title, setTitle] = React.useState("");
  const [priority, setPriority] = React.useState<TaskPriority>("MEDIUM");
  const [assignment, setAssignment] = React.useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }

    await onCreate({
      title: title.trim(),
      description: "",
      priority,
      ...assignmentInputFromValue(assignment)
    });

    setTitle("");
    setPriority("MEDIUM");
    setAssignment("");
  };

  return (
    <form className="task-create" onSubmit={handleSubmit}>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Задача в "${column.title}"`} />
      <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
        <option value="LOW">низкий</option>
        <option value="MEDIUM">средний</option>
        <option value="HIGH">высокий</option>
      </select>
      <select value={assignment} onChange={(event) => setAssignment(event.target.value)}>
        <option value="">Без адресата</option>
        {members.length > 0 ? (
          <optgroup label="Участники">
            {members.map((member) => (
              <option value={`user:${member.user.id}`} key={member.user.id}>{member.user.name}</option>
            ))}
          </optgroup>
        ) : null}
        {groups.length > 0 ? (
          <optgroup label="Группы">
            {groups.map((group) => (
              <option value={`group:${group.id}`} key={group.id}>{group.name}</option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <button>Добавить</button>
    </form>
  );
}

type BoardColumnViewProps = {
  column: BoardColumn;
  members: ProjectMember[];
  groups: TaskGroup[];
  canManageColumn: boolean;
  canCreateTask: boolean;
  canEditTask: (task: Task) => boolean;
  canDeleteTask: (task: Task) => boolean;
  canMoveTask: (task: Task) => boolean;
  canAssignTask: boolean;
  onRenameColumn: (column: BoardColumn) => Promise<void>;
  onDeleteColumn: (column: BoardColumn) => Promise<void>;
  onCreateTask: (column: BoardColumn, input: TaskCreateInput) => Promise<void>;
  onDeleteTask: (task: Task) => Promise<void>;
  onQuickEdit: (task: Task) => Promise<void>;
  onAssignTask: (task: Task, input: TaskAssignmentInput) => Promise<void>;
};

function BoardColumnView({
  column,
  members,
  groups,
  canManageColumn,
  canCreateTask,
  canEditTask,
  canDeleteTask,
  canMoveTask,
  canAssignTask,
  onRenameColumn,
  onDeleteColumn,
  onCreateTask,
  onDeleteTask,
  onQuickEdit,
  onAssignTask
}: BoardColumnViewProps) {
  const drop = useDroppable({ id: `column-drop:${column.id}`, data: { type: "column", columnId: column.id } });

  return (
    <section ref={drop.setNodeRef} className={`board-column ${drop.isOver ? "is-over" : ""}`}>
      <header>
        <div>
          <h2>{column.title}</h2>
          {column.description ? <p className="column-description">{column.description}</p> : null}
          {canManageColumn ? (
            <div className="column-actions">
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { void onRenameColumn(column); }}>Изменить</button>
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => { void onDeleteColumn(column); }}>Удалить</button>
            </div>
          ) : null}
        </div>
        <span>{column.tasks.length}</span>
      </header>

      <div className="task-stack">
        {column.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            members={members}
            groups={groups}
            canEdit={canEditTask(task)}
            canDelete={canDeleteTask(task)}
            canMove={canMoveTask(task)}
            canAssign={canAssignTask}
            onDelete={onDeleteTask}
            onQuickEdit={onQuickEdit}
            onAssign={onAssignTask}
          />
        ))}
      </div>

      {canCreateTask ? (
        <TaskCreateForm column={column} members={members} groups={groups} onCreate={(input) => onCreateTask(column, input)} />
      ) : (
        <p className="hint column-hint">Новые задачи добавляют владелец и администраторы проекта.</p>
      )}
    </section>
  );
}

function EventFeed({ events, columns, expanded = false }: { events: SyncEvent[]; columns: BoardColumn[]; expanded?: boolean }) {
  return (
    <aside className={expanded ? "event-feed event-feed-expanded" : "event-feed"}>
      <div className="panel-heading">
        <h2>Журнал событий</h2>
      </div>

      {events.length === 0 ? <p className="hint">Событий пока нет.</p> : null}

      {events.map((event) => {
        const taskTitle = getTaskTitleFromEvent(event);
        const moveLabel = getTaskMoveFromEvent(event, columns);
        const conflictLabel = getConflictLabel(event);

        return (
          <article className={conflictLabel ? "has-conflict" : ""} key={event.id}>
            <span className={`event-dot ${event.type.toLowerCase()}`} />
            <strong>{formatEventType(event.type)}</strong>
            <span>{new Date(event.createdAt).toLocaleString("ru-RU")}</span>
            <span className="event-actor">{actorLabel(event)}</span>
            {taskTitle ? <span className="event-task">{taskTitle}</span> : null}
            {moveLabel ? <span>{moveLabel}</span> : null}
            {conflictLabel ? <span className="event-conflict">{conflictLabel}</span> : null}
          </article>
        );
      })}
    </aside>
  );
}

function ModalShell({
  title,
  eyebrow,
  children,
  onClose
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-heading">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2>{title}</h2>
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>Закрыть</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function ColumnDialog({
  mode,
  column,
  onSubmit,
  onClose
}: {
  mode: "create" | "edit";
  column?: BoardColumn;
  onSubmit: (input: { title: string; description: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState(column?.title ?? "");
  const [description, setDescription] = React.useState(column?.description ?? "");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), description: description.trim() });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={mode === "create" ? "Новая колонка" : "Редактирование колонки"}
      eyebrow="Структура Kanban"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Название
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} autoFocus />
        </label>
        <label>
          Описание этапа
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={600} />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Отмена</button>
          <button className="primary-button" disabled={submitting || !title.trim()}>
            {submitting ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TaskDialog({
  task,
  onSubmit,
  onClose
}: {
  task: Task;
  onSubmit: (task: Task, input: { title: string; description: string; priority: TaskPriority }) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = React.useState(task.title);
  const [description, setDescription] = React.useState(task.description);
  const [priority, setPriority] = React.useState<TaskPriority>(task.priority);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(task, {
        title: title.trim(),
        description: description.trim(),
        priority
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Редактирование задачи" eyebrow="Карточка проекта" onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Название
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} autoFocus />
        </label>
        <label>
          Описание
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={1200} />
        </label>
        <label>
          Приоритет
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
            {priorityValues.map((value) => (
              <option value={value} key={value}>{priorityLabel[value]}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Отмена</button>
          <button className="primary-button" disabled={submitting || !title.trim()}>
            {submitting ? "Сохраняем..." : "Сохранить"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [submitting, setSubmitting] = React.useState(false);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title={title} eyebrow="Подтверждение действия" onClose={onClose}>
      <div className="confirm-body">
        <p>{message}</p>
        <div className="modal-actions">
          <button type="button" className="ghost-button" onClick={onClose}>Отмена</button>
          <button type="button" className="danger-button" disabled={submitting} onClick={() => { void handleConfirm(); }}>
            {submitting ? "Выполняем..." : confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function AuditView({
  board,
  events,
  metrics,
  columns,
  latency,
  onlineUsers
}: {
  board: Board | null;
  events: SyncEvent[];
  metrics: ProjectMetrics | null;
  columns: BoardColumn[];
  latency: number | null;
  onlineUsers: Array<{ id: string; name: string }>;
}) {
  const taskCount = board?.columns.reduce((sum, column) => sum + column.tasks.length, 0) ?? 0;
  const conflictCount = events.filter((event) => getConflictLabel(event)).length;

  return (
    <div className="workspace-panel audit-layout">
      <section className="roadmap-stats" aria-label="Метрики синхронизации">
        <article className="roadmap-stat-card">
          <span>Событий в журнале</span>
          <strong>{metrics?.eventsCount ?? events.length}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Последнее событие</span>
          <strong>{metrics?.lastEventAt ? new Date(metrics.lastEventAt).toLocaleTimeString("ru-RU") : "нет"}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Задержка WebSocket</span>
          <strong>{latency === null ? "нет" : `${latency} мс`}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Конфликты версий</span>
          <strong>{conflictCount}</strong>
        </article>
      </section>

      <section className="audit-panel">
        <div className="panel-heading">
          <p className="eyebrow">Дипломный сценарий</p>
          <h2>Что доказывает практическая часть</h2>
        </div>
        <div className="audit-proof-grid">
          <article>
            <strong>{board?.members.length ?? 0}</strong>
            <span>участников с ролями доступа</span>
          </article>
          <article>
            <strong>{taskCount}</strong>
            <span>задач синхронизируются через REST + WebSocket</span>
          </article>
          <article>
            <strong>{onlineUsers.length || 1}</strong>
            <span>активных подключений в комнате проекта</span>
          </article>
          <article>
            <strong>{metrics?.recentEventTypes.slice(0, 3).join(", ") || "нет событий"}</strong>
            <span>последние типы серверных событий</span>
          </article>
        </div>
      </section>

      <EventFeed events={events} columns={columns} expanded />
    </div>
  );
}

function RoadmapGoalCard({
  task,
  columns,
  members,
  groups,
  canManage,
  onEditGoal,
  onDeleteGoal,
  onAssignGoal
}: {
  task: Task;
  columns: BoardColumn[];
  members: ProjectMember[];
  groups: TaskGroup[];
  canManage: boolean;
  onEditGoal: (task: Task) => Promise<void>;
  onDeleteGoal: (task: Task) => Promise<void>;
  onAssignGoal: (task: Task, input: TaskAssignmentInput) => Promise<void>;
}) {
  const status = getRoadmapStatus(task, columns);

  return (
    <article className="roadmap-goal">
      <div className="roadmap-goal-head">
        <div>
          <span className={`roadmap-chip roadmap-chip-${status}`}>{roadmapStatusLabel[status]}</span>
          <h3>{task.title}</h3>
        </div>
        <span className={`priority ${task.priority.toLowerCase()}`}>{priorityLabel[task.priority]}</span>
      </div>

      {task.description ? <p>{task.description}</p> : <p className="hint">Описание пока не добавлено.</p>}

      <div className="roadmap-goal-meta">
        <span>Исполнитель</span>
        {canManage ? (
          <select value={assignmentValue(task)} onChange={(event) => { void onAssignGoal(task, assignmentInputFromValue(event.target.value)); }}>
            <option value="">Не назначен</option>
            {members.length > 0 ? (
              <optgroup label="Участники">
                {members.map((member) => (
                  <option value={`user:${member.user.id}`} key={member.user.id}>{member.user.name}</option>
                ))}
              </optgroup>
            ) : null}
            {groups.length > 0 ? (
              <optgroup label="Группы">
                {groups.map((group) => (
                  <option value={`group:${group.id}`} key={group.id}>{group.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        ) : (
          <strong>{assignmentLabel(task)}</strong>
        )}
      </div>

      <div className="roadmap-goal-meta">
        <span>Этап</span>
        <strong>{getColumnTitleById(columns, task.columnId) ?? "Без этапа"}</strong>
      </div>

      <div className="roadmap-goal-meta">
        <span>Создал/а</span>
        <strong>{task.creator.name}</strong>
      </div>

      {canManage ? (
        <div className="roadmap-actions">
          <button type="button" onClick={() => { void onEditGoal(task); }}>Изменить</button>
          <button type="button" onClick={() => { void onDeleteGoal(task); }}>Удалить</button>
        </div>
      ) : null}
    </article>
  );
}

function RoadmapComposer({
  columns,
  members,
  groups,
  canManage,
  onCreateGoal
}: {
  columns: BoardColumn[];
  members: ProjectMember[];
  groups: TaskGroup[];
  canManage: boolean;
  onCreateGoal: (input: TaskCreateInput & { columnId: string }) => Promise<void>;
}) {
  const [columnId, setColumnId] = React.useState(columns[0]?.id ?? "");
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [priority, setPriority] = React.useState<TaskPriority>("MEDIUM");
  const [assignment, setAssignment] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!columns.some((column) => column.id === columnId)) {
      setColumnId(columns[0]?.id ?? "");
    }
  }, [columnId, columns]);

  if (!canManage) {
    return <p className="roadmap-readonly">Участники могут только просматривать дорожную карту. Добавлять и менять цели могут владелец и администраторы.</p>;
  }

  if (columns.length === 0) {
    return <p className="roadmap-readonly">Сначала создайте этапы на вкладке «Доски», а затем добавляйте цели в roadmap.</p>;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!columnId || !title.trim()) {
      return;
    }

    setSubmitting(true);
    try {
      await onCreateGoal({
        columnId,
        title: title.trim(),
        description: description.trim(),
        priority,
        ...assignmentInputFromValue(assignment)
      });
      setTitle("");
      setDescription("");
      setPriority("MEDIUM");
      setAssignment("");
    } catch {
      // Ошибка показывается в общем notice.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="roadmap-composer" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <p className="eyebrow">Новая цель</p>
        <h2>Добавить этапную задачу в roadmap</h2>
      </div>

      <div className="roadmap-composer-grid">
        <label>
          Этап
          <select value={columnId} onChange={(event) => setColumnId(event.target.value)}>
            {columns.map((column) => (
              <option value={column.id} key={column.id}>{column.title}</option>
            ))}
          </select>
        </label>

        <label>
          Приоритет
          <select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)}>
            {priorityValues.map((value) => (
              <option value={value} key={value}>{priorityLabel[value]}</option>
            ))}
          </select>
        </label>

        <label>
          Название цели
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например, подготовить прототип кабинета" />
        </label>

        <label>
          Исполнитель
          <select value={assignment} onChange={(event) => setAssignment(event.target.value)}>
            <option value="">Не назначен</option>
            {members.length > 0 ? (
              <optgroup label="Участники">
                {members.map((member) => (
                  <option value={`user:${member.user.id}`} key={member.user.id}>{member.user.name}</option>
                ))}
              </optgroup>
            ) : null}
            {groups.length > 0 ? (
              <optgroup label="Группы">
                {groups.map((group) => (
                  <option value={`group:${group.id}`} key={group.id}>{group.name}</option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
      </div>

      <label>
        Подробное описание
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} placeholder="Опишите ожидаемый результат, критерии готовности и важные детали для команды." />
      </label>

      <button className="primary-button" disabled={submitting}>{submitting ? "Сохраняем..." : "Добавить цель"}</button>
    </form>
  );
}

function RoadmapView({
  board,
  currentRole,
  members,
  groups,
  onCreateGoal,
  onEditGoal,
  onDeleteGoal,
  onAssignGoal
}: {
  board: Board | null;
  currentRole: ProjectRole | null;
  members: ProjectMember[];
  groups: TaskGroup[];
  onCreateGoal: (input: TaskCreateInput & { columnId: string }) => Promise<void>;
  onEditGoal: (task: Task) => Promise<void>;
  onDeleteGoal: (task: Task) => Promise<void>;
  onAssignGoal: (task: Task, input: TaskAssignmentInput) => Promise<void>;
}) {
  const columns = React.useMemo(() => sortColumns(board?.columns ?? []), [board?.columns]);
  const stats = React.useMemo(() => getRoadmapStats(board), [board]);
  const canManage = isAdminRole(currentRole);

  return (
    <div className="roadmap-shell">
      <section className="roadmap-stats" aria-label="Статусы roadmap">
        <article className="roadmap-stat-card">
          <span>Предстоящие</span>
          <strong>{stats.upcoming}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Активные</span>
          <strong>{stats.active}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Неактивные</span>
          <strong>{stats.inactive}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Завершенные</span>
          <strong>{stats.completed}</strong>
        </article>
      </section>

      <section className="roadmap-board-panel">
        <div className="panel-heading roadmap-board-heading">
          <p className="eyebrow">Roadmap</p>
          <h2>Связанный маршрут задач проекта</h2>
          <p>Сначала видно весь путь: от старта через этапы и связанные цели до финальной точки.</p>
        </div>

        <section className="roadmap-trackboard" aria-label="Roadmap проекта">
          <article className="roadmap-cap">
            <span className="roadmap-cap-dot" />
            <strong>Старт</strong>
            <p>Точка входа в маршрут проекта.</p>
          </article>

          {columns.length === 0 ? (
            <div className="roadmap-empty">Пока нет этапов. Создайте колонки на вкладке «Доски», чтобы собрать связанную дорожную карту.</div>
          ) : (
            columns.map((column, index) => (
              <section className="roadmap-stage" key={column.id}>
                <div className="roadmap-stage-anchor">
                  <span className="roadmap-stage-step">{index + 1}</span>
                  <div>
                    <p className="eyebrow">Этап {index + 1}</p>
                    <h2>{column.title}</h2>
                    {column.description ? <p className="column-description">{column.description}</p> : null}
                  </div>
                </div>

                <div className="roadmap-stage-list">
                  {column.tasks.length === 0 ? (
                    <div className="roadmap-empty">В этом этапе пока нет целей.</div>
                  ) : (
                    column.tasks.map((task) => (
                      <RoadmapGoalCard
                        key={task.id}
                        task={task}
                        columns={columns}
                        members={members}
                        groups={groups}
                        canManage={canManage}
                        onEditGoal={onEditGoal}
                        onDeleteGoal={onDeleteGoal}
                        onAssignGoal={onAssignGoal}
                      />
                    ))
                  )}
                </div>
              </section>
            ))
          )}

          <article className="roadmap-cap roadmap-cap-end">
            <span className="roadmap-cap-dot" />
            <strong>Финиш</strong>
            <p>Финальная точка маршрута и выполненные цели.</p>
          </article>
        </section>
      </section>

      <RoadmapComposer columns={columns} members={members} groups={groups} canManage={canManage} onCreateGoal={onCreateGoal} />
    </div>
  );
}

function AnnouncementComposer({
  members,
  canCreate,
  onCreate
}: {
  members: ProjectMember[];
  canCreate: boolean;
  onCreate: (input: { title: string; body: string; priority: AnnouncementPriority; expiresAt?: string | null; recipientMemberIds: string[]; recipientRoles: ProjectRole[] }) => Promise<void>;
}) {
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [priority, setPriority] = React.useState<AnnouncementPriority>("NORMAL");
  const [expiresAt, setExpiresAt] = React.useState("");
  const [recipientMemberIds, setRecipientMemberIds] = React.useState<string[]>([]);
  const [recipientRoles, setRecipientRoles] = React.useState<ProjectRole[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    setRecipientMemberIds((current) => current.filter((id) => members.some((member) => member.id === id)));
  }, [members]);

  const toggleRecipient = (memberId: string) => {
    setRecipientMemberIds((current) => current.includes(memberId)
      ? current.filter((id) => id !== memberId)
      : [...current, memberId]);
  };

  const toggleRole = (role: ProjectRole) => {
    setRecipientRoles((current) => current.includes(role)
      ? current.filter((item) => item !== role)
      : [...current, role]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canCreate || !title.trim() || (recipientMemberIds.length === 0 && recipientRoles.length === 0)) {
      return;
    }

    setSubmitting(true);
    try {
      await onCreate({
        title: title.trim(),
        body: body.trim(),
        priority,
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
        recipientMemberIds,
        recipientRoles
      });
      setTitle("");
      setBody("");
      setPriority("NORMAL");
      setExpiresAt("");
      setRecipientMemberIds([]);
      setRecipientRoles([]);
    } catch {
      // Ошибка показывается в общем notice.
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreate) {
    return <p className="roadmap-readonly">Объявления создают владелец и администраторы проекта.</p>;
  }

  return (
    <form className="announcement-composer" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <p className="eyebrow">Новое объявление</p>
        <h2>Сообщение для выбранных адресатов</h2>
      </div>

      <label>
        Заголовок
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} placeholder="Например, созвон по демонстрации" />
      </label>

      <label>
        Текст
        <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} maxLength={2000} placeholder="Коротко опишите, что нужно обязательно увидеть." />
      </label>

      <div className="announcement-form-grid">
        <label>
          Важность
          <select value={priority} onChange={(event) => setPriority(event.target.value as AnnouncementPriority)}>
            {announcementPriorityValues.map((value) => (
              <option value={value} key={value}>{announcementPriorityLabel[value]}</option>
            ))}
          </select>
        </label>

        <label>
          Актуально до
          <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
        </label>
      </div>

      <div className="announcement-recipient-list">
        {(["OWNER", "ADMIN", "MEMBER"] as ProjectRole[]).map((role) => (
          <label className="checkbox-row" key={role}>
            <input type="checkbox" checked={recipientRoles.includes(role)} onChange={() => toggleRole(role)} />
            <span>Все: {roleLabel[role]}</span>
          </label>
        ))}
      </div>

      <div className="announcement-recipient-list">
        {members.map((member) => (
          <label className="checkbox-row" key={member.id}>
            <input type="checkbox" checked={recipientMemberIds.includes(member.id)} onChange={() => toggleRecipient(member.id)} />
            <span>{member.user.name} · {roleLabel[member.role]}</span>
          </label>
        ))}
      </div>

      <button className="primary-button" disabled={submitting || !title.trim() || (recipientMemberIds.length === 0 && recipientRoles.length === 0)}>
        {submitting ? "Публикуем..." : "Опубликовать"}
      </button>
    </form>
  );
}

type AnnouncementFilter = "active" | "unread" | "important" | "urgent" | "created" | "archived";

const announcementFilterLabel: Record<AnnouncementFilter, string> = {
  active: "Актуальные",
  unread: "Непрочитанные",
  important: "Важные",
  urgent: "Срочные",
  created: "Созданные мной",
  archived: "Архив"
};

function EventsView({
  announcements,
  members,
  currentRole,
  unreadCount,
  onCreateAnnouncement,
  onMarkAllRead,
  onMarkRead,
  onAcknowledge,
  onArchive,
  currentUserId
}: {
  announcements: Announcement[];
  members: ProjectMember[];
  currentRole: ProjectRole | null;
  unreadCount: number;
  onCreateAnnouncement: (input: { title: string; body: string; priority: AnnouncementPriority; expiresAt?: string | null; recipientMemberIds: string[]; recipientRoles: ProjectRole[] }) => Promise<void>;
  onMarkAllRead: () => Promise<void>;
  onMarkRead: (announcement: Announcement) => Promise<void>;
  onAcknowledge: (announcement: Announcement) => Promise<void>;
  onArchive: (announcement: Announcement) => Promise<void>;
  currentUserId: string;
}) {
  const canCreate = isAdminRole(currentRole);
  const [filter, setFilter] = React.useState<AnnouncementFilter>("active");
  const now = Date.now();
  const isExpired = (announcement: Announcement) => Boolean(announcement.expiresAt && new Date(announcement.expiresAt).getTime() < now);
  const activeAnnouncements = announcements.filter((announcement) => !announcement.archivedAt && !isExpired(announcement));
  const archivedAnnouncements = announcements.filter((announcement) => announcement.archivedAt || isExpired(announcement));
  const visibleAnnouncements = (filter === "archived" ? archivedAnnouncements : activeAnnouncements).filter((announcement) => {
    if (filter === "unread") {
      return !announcement.readAt;
    }
    if (filter === "important") {
      return announcement.priority === "IMPORTANT" || announcement.priority === "URGENT";
    }
    if (filter === "urgent") {
      return announcement.priority === "URGENT";
    }
    if (filter === "created") {
      return announcement.authorId === currentUserId;
    }
    return true;
  });
  const confirmedCount = announcements.reduce((sum, announcement) => sum + announcement.recipients.filter((recipient) => recipient.acknowledgedAt).length, 0);

  return (
    <div className="workspace-panel events-layout">
      <section className="roadmap-stats" aria-label="Сводка объявлений">
        <article className="roadmap-stat-card">
          <span>Объявлений</span>
          <strong>{announcements.length}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Непрочитанных</span>
          <strong>{unreadCount}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>В архиве</span>
          <strong>{archivedAnnouncements.length}</strong>
        </article>
        <article className="roadmap-stat-card">
          <span>Подтверждений</span>
          <strong>{confirmedCount}</strong>
        </article>
      </section>

      <section className="announcement-board">
        <div className="panel-heading">
          <p className="eyebrow">Доска объявлений</p>
          <h2>Важные сообщения проекта</h2>
        </div>

        {announcements.length === 0 ? <p className="hint">Объявлений пока нет.</p> : null}

        <div className="announcement-toolbar">
          {(Object.keys(announcementFilterLabel) as AnnouncementFilter[]).map((value) => (
            <button type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>
              {announcementFilterLabel[value]}
            </button>
          ))}
          <button type="button" className="ghost-button" onClick={() => { void onMarkAllRead(); }} disabled={unreadCount === 0}>Отметить все прочитанными</button>
        </div>

        {visibleAnnouncements.length === 0 ? <p className="hint">Объявлений в этом фильтре нет.</p> : null}

        {visibleAnnouncements.map((announcement) => (
          <article className={`announcement-card priority-${announcement.priority.toLowerCase()} ${announcement.readAt ? "" : "unread"}`} key={announcement.id}>
            <div className="announcement-card-head">
              <div>
                <h3>{announcement.title}</h3>
                <span>{new Date(announcement.createdAt).toLocaleString("ru-RU")}</span>
              </div>
              <div className="announcement-card-badges">
                <span className="announcement-priority">{announcementPriorityLabel[announcement.priority]}</span>
                {!announcement.readAt ? <span className="announcement-unread">новое</span> : null}
                {isExpired(announcement) ? <span className="announcement-expired">истекло</span> : null}
              </div>
            </div>
            {announcement.body ? <p>{announcement.body}</p> : null}
            <div className="announcement-meta">
              <span>{announcement.author ? `Автор: ${announcement.author.name}` : "Автор: система"}</span>
              {announcement.expiresAt ? <span>Актуально до: {new Date(announcement.expiresAt).toLocaleDateString("ru-RU")}</span> : null}
              <span>Адресаты: {announcement.recipients.map((recipient) => recipient.member.user.name).join(", ")}</span>
            </div>
            {canCreate ? (
              <div className="announcement-read-state">
                {announcement.recipients.map((recipient) => (
                  <span className={recipient.acknowledgedAt ? "confirmed" : recipient.readAt ? "read" : "pending"} key={recipient.id}>
                    {recipient.member.user.name}: {recipient.acknowledgedAt ? "подтвердил" : recipient.readAt ? "прочитал" : "не прочитал"}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="announcement-actions">
              {!announcement.readAt ? <button type="button" onClick={() => { void onMarkRead(announcement); }}>Прочитано</button> : null}
              {!announcement.acknowledgedAt ? <button type="button" onClick={() => { void onAcknowledge(announcement); }}>Понял</button> : null}
              {!announcement.archivedAt ? <button type="button" className="ghost-button" onClick={() => { void onArchive(announcement); }}>В архив</button> : null}
            </div>
          </article>
        ))}
      </section>

      <AnnouncementComposer members={members} canCreate={canCreate} onCreate={onCreateAnnouncement} />
    </div>
  );
}

function BoardScreen({ auth, onLogout }: { auth: AuthState; onLogout: () => void }) {
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [board, setBoard] = React.useState<Board | null>(null);
  const [events, setEvents] = React.useState<SyncEvent[]>([]);
  const [metrics, setMetrics] = React.useState<ProjectMetrics | null>(null);
  const [announcements, setAnnouncements] = React.useState<Announcement[]>([]);
  const [unreadAnnouncements, setUnreadAnnouncements] = React.useState(0);
  const [connection, setConnection] = React.useState<ConnectionState>("offline");
  const [latency, setLatency] = React.useState<number | null>(null);
  const [onlineUsers, setOnlineUsers] = React.useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = React.useState("");
  const [showEventFeed, setShowEventFeed] = React.useState(false);
  const [activeDragTask, setActiveDragTask] = React.useState<Task | null>(null);
  const [view, setView] = React.useState<WorkspaceView>("board");
  const [columnDialog, setColumnDialog] = React.useState<{ mode: "create" } | { mode: "edit"; column: BoardColumn } | null>(null);
  const [taskDialog, setTaskDialog] = React.useState<Task | null>(null);
  const [confirmDialog, setConfirmDialog] = React.useState<{
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => Promise<void>;
  } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const currentRole = board?.members.find((member) => member.user.id === auth.user.id)?.role
    ?? projects.find((project) => project.id === activeProjectId)?.role
    ?? null;
  const canManageBoard = isAdminRole(currentRole);
  const canCreateProjects = React.useMemo(
    () => projects.some((project) => isAdminRole(project.role ?? "MEMBER")),
    [projects]
  );
  const taskTargetMembers = React.useMemo(
    () => allowedMemberTargets(board?.members ?? [], currentRole),
    [board?.members, currentRole]
  );
  const taskTargetGroups = React.useMemo(
    () => allowedGroupTargets(board?.groups ?? [], currentRole),
    [board?.groups, currentRole]
  );

  const canEditTask = React.useCallback((task: Task) => canManageBoard, [canManageBoard]);
  const canMoveTask = React.useCallback((task: Task) => canManageBoard || taskIsAddressedToUser(task, auth.user.id), [auth.user.id, canManageBoard]);
  const canDeleteTask = React.useCallback((task: Task) => canManageBoard, [canManageBoard]);

  const loadProjects = React.useCallback(async () => {
    const response = await api.projects(auth.token);
    setProjects(response.projects);
    setActiveProjectId((current) => {
      if (current && response.projects.some((project) => project.id === current)) {
        return current;
      }
      return response.projects[0]?.id ?? null;
    });
  }, [auth.token]);

  const loadBoard = React.useCallback(async () => {
    if (!activeProjectId) {
      setBoard(null);
      setEvents([]);
      setMetrics(null);
      setAnnouncements([]);
      setUnreadAnnouncements(0);
      return;
    }

    const [boardResponse, eventsResponse, metricsResponse, announcementsResponse] = await Promise.all([
      api.board(auth.token, activeProjectId),
      api.events(auth.token, activeProjectId),
      api.metrics(auth.token, activeProjectId),
      api.announcements(auth.token, activeProjectId)
    ]);

    setBoard(boardResponse.board);
    setEvents(eventsResponse.events);
    setMetrics(metricsResponse.metrics);
    setAnnouncements(announcementsResponse.announcements);
    setUnreadAnnouncements(announcementsResponse.unreadCount);
  }, [activeProjectId, auth.token]);

  const loadAnnouncements = React.useCallback(async () => {
    if (!activeProjectId) {
      setAnnouncements([]);
      setUnreadAnnouncements(0);
      return;
    }

    const response = await api.announcements(auth.token, activeProjectId);
    setAnnouncements(response.announcements);
    setUnreadAnnouncements(response.unreadCount);
  }, [activeProjectId, auth.token]);

  const markAnnouncementsRead = React.useCallback(async () => {
    if (!activeProjectId) {
      return;
    }

    await api.markAnnouncementsRead(auth.token, activeProjectId);
    setUnreadAnnouncements(0);
    setAnnouncements((current) => current.map((announcement) => (
      announcement.readAt ? announcement : { ...announcement, readAt: new Date().toISOString() }
    )));
  }, [activeProjectId, auth.token]);

  const markAnnouncementRead = React.useCallback(async (announcement: Announcement) => {
    if (!activeProjectId) {
      return;
    }

    await api.markAnnouncementRead(auth.token, activeProjectId, announcement.id);
    await loadAnnouncements();
  }, [activeProjectId, auth.token, loadAnnouncements]);

  const acknowledgeAnnouncement = React.useCallback(async (announcement: Announcement) => {
    if (!activeProjectId) {
      return;
    }

    await api.acknowledgeAnnouncement(auth.token, activeProjectId, announcement.id);
    await loadAnnouncements();
  }, [activeProjectId, auth.token, loadAnnouncements]);

  const archiveAnnouncement = React.useCallback(async (announcement: Announcement) => {
    if (!activeProjectId) {
      return;
    }

    await api.archiveAnnouncement(auth.token, activeProjectId, announcement.id);
    await loadAnnouncements();
  }, [activeProjectId, auth.token, loadAnnouncements]);

  React.useEffect(() => {
    loadProjects().catch((loadError) => {
      setError(safeError(loadError, "Не удалось загрузить проекты"));
    });
  }, [loadProjects]);

  React.useEffect(() => {
    loadBoard().catch((loadError) => {
      setError(safeError(loadError, "Не удалось загрузить доску"));
    });
  }, [loadBoard]);

  React.useEffect(() => {
    if (!activeProjectId) {
      setConnection("offline");
      setOnlineUsers([]);
      return;
    }

    setConnection("connecting");
    const socket: Socket = io("/", {
      auth: { token: auth.token },
      transports: ["websocket", "polling"]
    });

    socket.on("connect", () => {
      setConnection("online");
      socket.emit("project:join", { projectId: activeProjectId });
    });

    socket.on("disconnect", () => {
      setConnection("offline");
      setOnlineUsers([]);
    });

    socket.on("connect_error", () => {
      setConnection("offline");
    });

    socket.on("presence:update", (payload: { projectId: string; users: Array<{ id: string; name: string }> }) => {
      if (payload.projectId === activeProjectId) {
        setOnlineUsers(payload.users);
      }
    });

    socket.on("sync:event", (payload: { projectId: string; serverTime?: number }) => {
      if (payload.projectId !== activeProjectId) {
        return;
      }

      if (typeof payload.serverTime === "number") {
        setLatency(Math.max(0, Date.now() - payload.serverTime));
      }

      loadBoard().catch(() => {
        // Общая ошибка уже отображается в UI после следующего явного действия.
      });
    });

    socket.on("announcement:created", (payload: Announcement & { serverTime?: number }) => {
      if (payload.projectId !== activeProjectId) {
        return;
      }

      if (typeof payload.serverTime === "number") {
        setLatency(Math.max(0, Date.now() - payload.serverTime));
      }

      if (view === "announcements") {
        loadAnnouncements()
          .then(() => undefined)
          .catch(() => {
            // Общая ошибка уже отобразится при следующем явном действии.
          });
      } else {
        loadAnnouncements().catch(() => {
          // Общая ошибка уже отобразится при следующем явном действии.
        });
      }
    });

    const pingTimer = window.setInterval(() => {
      socket.timeout(1500).emit("ping", { sentAt: Date.now() }, (requestError: unknown, response?: { sentAt: number }) => {
        if (!requestError && response) {
          setLatency(Date.now() - response.sentAt);
        }
      });
    }, 5000);

    return () => {
      window.clearInterval(pingTimer);
      socket.emit("project:leave", { projectId: activeProjectId });
      socket.disconnect();
    };
  }, [activeProjectId, auth.token, loadAnnouncements, loadBoard, markAnnouncementsRead, view]);

  const createProject = async (input: { name: string; description: string }) => {
    if (!canCreateProjects) {
      setError("Пространства создают только владелец и администраторы.");
      return;
    }

    try {
      const response = await api.createProject(auth.token, input);
      setProjects((current) => [{ ...response.project, role: "OWNER" }, ...current]);
      setActiveProjectId(response.project.id);
      setView("board");
    } catch (createError) {
      setError(safeError(createError, "Не удалось создать пространство"));
      throw createError;
    }
  };

  const createColumn = async () => {
    if (!activeProjectId) {
      return;
    }

    if (!canManageBoard) {
      setError("Колонки создают владелец и администраторы проекта.");
      return;
    }

    setColumnDialog({ mode: "create" });
  };

  const renameColumn = async (column: BoardColumn) => {
    if (!canManageBoard) {
      setError("Колонки меняют владелец и администраторы проекта.");
      return;
    }

    setColumnDialog({ mode: "edit", column });
  };

  const deleteColumn = async (column: BoardColumn) => {
    if (!canManageBoard) {
      setError("Колонки удаляют владелец и администраторы проекта.");
      return;
    }

    setConfirmDialog({
      title: "Удалить колонку",
      message: `Колонка "${column.title}" и все задачи внутри нее будут удалены.`,
      confirmLabel: "Удалить",
      onConfirm: async () => {
        try {
          await api.deleteColumn(auth.token, column.id);
          await loadBoard();
        } catch (deleteError) {
          setError(safeError(deleteError, "Не удалось удалить колонку"));
        }
      }
    });
  };

  const createTask = async (column: BoardColumn, input: TaskCreateInput) => {
    if (!activeProjectId) {
      return;
    }

    if (!canManageBoard) {
      setError("Новые задачи добавляют владелец и администраторы проекта.");
      return;
    }

    await api.createTask(auth.token, activeProjectId, { columnId: column.id, ...input });
    await loadBoard();
  };

  const createRoadmapGoal = async (input: TaskCreateInput & { columnId: string }) => {
    if (!activeProjectId) {
      return;
    }

    if (!canManageBoard) {
      setError("Цели roadmap добавляют только владелец и администраторы проекта.");
      return;
    }

    await api.createTask(auth.token, activeProjectId, input);
    await loadBoard();
  };

  const deleteTask = async (task: Task) => {
    if (!canManageBoard) {
      setError("Удалять задачи могут только владелец и администраторы проекта.");
      return;
    }

    setConfirmDialog({
      title: "Удалить задачу",
      message: `Задача "${task.title}" будет удалена из проекта и журнала текущей доски.`,
      confirmLabel: "Удалить",
      onConfirm: async () => {
        await api.deleteTask(auth.token, task.id);
        await loadBoard();
      }
    });
  };

  const quickEditTask = async (task: Task) => {
    if (!canEditTask(task)) {
      setError("Изменять задачи могут только владелец и администраторы.");
      return;
    }

    setTaskDialog(task);
  };

  const submitColumnDialog = async (input: { title: string; description: string }) => {
    if (!activeProjectId || !columnDialog) {
      return;
    }

    if (columnDialog.mode === "create") {
      await api.createColumn(auth.token, activeProjectId, input);
      await loadBoard();
      return;
    }

    if (input.title === columnDialog.column.title && input.description === columnDialog.column.description) {
      return;
    }

    await api.updateColumn(auth.token, columnDialog.column.id, input);
    await loadBoard();
  };

  const submitTaskDialog = async (task: Task, input: { title: string; description: string; priority: TaskPriority }) => {
    const response = await api.updateTask(auth.token, task.id, {
      ...input,
      clientVersion: task.version
    });

    if (response.conflictResolved) {
      setError("Конфликт версий разрешен: принято последнее действие.");
    }

    await loadBoard();
  };

  const assignTask = async (task: Task, input: TaskAssignmentInput) => {
    if (!canManageBoard) {
      setError("Назначать исполнителей могут только владелец и администраторы проекта.");
      return;
    }

    const response = await api.updateTask(auth.token, task.id, {
      ...input,
      clientVersion: task.version
    });

    if (response.conflictResolved) {
      setError("Конфликт версий разрешен: принято последнее действие.");
    }

    await loadBoard();
  };

  const addMember = async (input: MemberCreateInput) => {
    if (!activeProjectId) {
      return;
    }

    try {
      const response = await api.addMember(auth.token, activeProjectId, input);
      await Promise.all([loadBoard(), loadProjects()]);
      if (response.createdUser && response.temporaryPassword) {
        setError(`Пользователь ${input.email} создан и добавлен. Пароль: ${response.temporaryPassword}`);
      }
    } catch (memberError) {
      setError(safeError(memberError, "Не удалось добавить участника"));
      throw memberError;
    }
  };

  const changeMemberRole = async (member: ProjectMember, role: Exclude<ProjectRole, "OWNER">) => {
    if (!activeProjectId) {
      return;
    }

    try {
      await api.updateMember(auth.token, activeProjectId, member.id, { role });
      await Promise.all([loadBoard(), loadProjects()]);
    } catch (updateError) {
      setError(safeError(updateError, "Не удалось изменить роль"));
      throw updateError;
    }
  };

  const removeMember = async (member: ProjectMember) => {
    if (!activeProjectId) {
      return;
    }

    try {
      await api.removeMember(auth.token, activeProjectId, member.id);
      await Promise.all([loadBoard(), loadProjects()]);
    } catch (removeError) {
      setError(safeError(removeError, "Не удалось удалить участника"));
      throw removeError;
    }
  };

  const createGroup = async (input: { name: string; memberIds: string[] }) => {
    if (!activeProjectId) {
      return;
    }

    try {
      await api.createGroup(auth.token, activeProjectId, input);
      await loadBoard();
    } catch (createError) {
      setError(safeError(createError, "Не удалось создать группу"));
      throw createError;
    }
  };

  const createAnnouncement = async (input: { title: string; body: string; priority: AnnouncementPriority; expiresAt?: string | null; recipientMemberIds: string[]; recipientRoles: ProjectRole[] }) => {
    if (!activeProjectId) {
      return;
    }

    if (!canManageBoard) {
      setError("Объявления создают владелец и администраторы проекта.");
      return;
    }

    try {
      await api.createAnnouncement(auth.token, activeProjectId, input);
      await loadAnnouncements();
    } catch (createError) {
      setError(safeError(createError, "Не удалось создать объявление"));
      throw createError;
    }
  };

  const updateGroup = async (group: TaskGroup, input: { name?: string; memberIds?: string[] }) => {
    if (!activeProjectId) {
      return;
    }

    try {
      await api.updateGroup(auth.token, activeProjectId, group.id, input);
      await loadBoard();
    } catch (updateError) {
      setError(safeError(updateError, "Не удалось изменить группу"));
      throw updateError;
    }
  };

  const deleteGroup = async (group: TaskGroup) => {
    if (!activeProjectId) {
      return;
    }

    setConfirmDialog({
      title: "Удалить группу",
      message: `Группа "${group.name}" будет удалена. У задач с этой группой адресат будет очищен.`,
      confirmLabel: "Удалить",
      onConfirm: async () => {
        try {
          await api.deleteGroup(auth.token, activeProjectId, group.id);
          await loadBoard();
        } catch (deleteError) {
          setError(safeError(deleteError, "Не удалось удалить группу"));
          throw deleteError;
        }
      }
    });
  };

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveDragTask(findTask(board, String(event.active.id)));
  }, [board]);

  const handleDragEnd = React.useCallback(async (event: DragEndEvent) => {
    setActiveDragTask(null);

    if (!board || !event.over) {
      return;
    }

    const taskId = String(event.active.id);
    const task = findTask(board, taskId);
    if (!task) {
      return;
    }

    if (!canMoveTask(task)) {
      setError("Участник может перемещать только задачи, назначенные ему или его группе.");
      return;
    }

    const dropData = event.over.data.current as DropData | undefined;
    if (!dropData) {
      return;
    }

    const nextColumnId = dropData.columnId;
    const beforeTaskId = dropData.type === "task" && dropData.taskId !== task.id ? dropData.taskId : null;

    if (nextColumnId === task.columnId && !beforeTaskId) {
      return;
    }

    setBoard((current) => current ? optimisticMove(current, task.id, nextColumnId, beforeTaskId) : current);

    const response = await api.moveTask(auth.token, task.id, {
      columnId: nextColumnId,
      beforeTaskId,
      clientVersion: task.version
    });

    if (response.conflictResolved) {
      setError("Одновременное перемещение разрешено на сервере: принято последнее действие.");
    }

    await loadBoard();
  }, [auth.token, board, canMoveTask, loadBoard]);

  const taskCount = board?.columns.reduce((sum, column) => sum + column.tasks.length, 0) ?? 0;

  const workspaceMeta = view === "roadmap"
    ? {
        eyebrow: "Roadmap проекта",
        description: board?.description || "Дополнительное представление тех же задач по этапам проекта без расширения основной Kanban-модели."
      }
    : view === "announcements"
      ? {
          eyebrow: "Коммуникации проекта",
          description: "Адресные объявления доставляются участникам проекта и помогают показать realtime-уведомления за пределами карточек."
        }
      : view === "audit"
        ? {
            eyebrow: "Аудит и синхронизация",
            description: "Журнал серверных событий, метрики WebSocket и конфликты версий показывают надежность практической части."
        }
      : {
          eyebrow: "Доска задач",
          description: board?.description || "Главный сценарий диплома: REST сохраняет изменения, WebSocket доставляет события участникам без перезагрузки."
        };

  return (
    <main className="app-shell">
      <AppTopbar user={auth.user} view={view} unreadAnnouncements={unreadAnnouncements} onViewChange={setView} onLogout={onLogout} />

      <ProjectRail
        projects={projects}
        activeProjectId={activeProjectId}
        onSelect={setActiveProjectId}
        onCreate={createProject}
        user={auth.user}
        onLogout={onLogout}
        members={board?.members ?? []}
        groups={board?.groups ?? []}
        currentRole={currentRole}
        canCreateProjects={canCreateProjects}
        onAddMember={addMember}
        onChangeRole={changeMemberRole}
        onRemoveMember={removeMember}
        onCreateGroup={createGroup}
        onUpdateGroup={updateGroup}
        onDeleteGroup={deleteGroup}
      />

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{workspaceMeta.eyebrow}</p>
            <h1>{board?.name ?? "Загрузка доски..."}</h1>
            <p>{workspaceMeta.description}</p>
          </div>

          <div className="workspace-actions">
            {view === "board" ? (
              <>
                <button className="primary-button" onClick={() => { void createColumn(); }} disabled={!activeProjectId || !canManageBoard}>Новая колонка</button>
                <button className="view-pill" type="button" aria-expanded={showEventFeed} onClick={() => setShowEventFeed((current) => !current)}>
                  {showEventFeed ? "Скрыть журнал" : "Показать журнал"}
                </button>
              </>
            ) : null}
            {view !== "board" ? (
              <button className="view-pill active" type="button" onClick={() => setView("board")}>Перейти к доске</button>
            ) : null}
          </div>
        </header>

        <ConnectionBar connection={connection} latency={latency} users={onlineUsers} />

        {error ? <button className="notice" onClick={() => setError("")}>{error}</button> : null}

        {view === "board" ? (
          <>
            <section className="board-summary" aria-label="Сводка доски">
              <div>
                <span>Колонки</span>
                <strong>{board?.columns.length ?? 0}</strong>
              </div>
              <div>
                <span>Задачи</span>
                <strong>{taskCount}</strong>
              </div>
              <div>
                <span>Участники онлайн</span>
                <strong>{onlineUsers.length || 1}</strong>
              </div>
              <div>
                <span>Событий аудита</span>
                <strong>{metrics?.eventsCount ?? events.length}</strong>
              </div>
              <div>
                <span>Ваша роль</span>
                <strong>{currentRole ? roleLabel[currentRole] : "нет доступа"}</strong>
              </div>
            </section>

            <div className={`work-area ${showEventFeed ? "" : "feed-hidden"}`}>
              <DndContext sensors={sensors} onDragStart={handleDragStart} onDragCancel={() => setActiveDragTask(null)} onDragEnd={(event) => { void handleDragEnd(event); }}>
                <div className="board-grid">
                  {board?.columns.map((column) => (
                    <BoardColumnView
                      key={column.id}
                      column={column}
                      members={taskTargetMembers}
                      groups={taskTargetGroups}
                      canManageColumn={canManageBoard}
                      canCreateTask={canManageBoard}
                      canEditTask={canEditTask}
                      canDeleteTask={canDeleteTask}
                      canMoveTask={canMoveTask}
                      canAssignTask={canManageBoard}
                      onRenameColumn={renameColumn}
                      onDeleteColumn={deleteColumn}
                      onCreateTask={createTask}
                      onDeleteTask={deleteTask}
                      onQuickEdit={quickEditTask}
                      onAssignTask={assignTask}
                    />
                  ))}
                </div>

                <DragOverlay dropAnimation={null}>
                  {activeDragTask ? <TaskDragPreview task={activeDragTask} /> : null}
                </DragOverlay>
              </DndContext>

              {showEventFeed ? <EventFeed events={events} columns={board?.columns ?? []} /> : null}
            </div>
          </>
        ) : null}

        {view === "roadmap" ? (
          <RoadmapView
            board={board}
            currentRole={currentRole}
            members={taskTargetMembers}
            groups={taskTargetGroups}
            onCreateGoal={createRoadmapGoal}
            onEditGoal={quickEditTask}
            onDeleteGoal={deleteTask}
            onAssignGoal={assignTask}
          />
        ) : null}

        {view === "announcements" ? (
          <EventsView
            announcements={announcements}
            members={board?.members ?? []}
            currentRole={currentRole}
            currentUserId={auth.user.id}
            unreadCount={unreadAnnouncements}
            onCreateAnnouncement={createAnnouncement}
            onMarkAllRead={markAnnouncementsRead}
            onMarkRead={markAnnouncementRead}
            onAcknowledge={acknowledgeAnnouncement}
            onArchive={archiveAnnouncement}
          />
        ) : null}

        {view === "audit" ? (
          <AuditView
            board={board}
            events={events}
            metrics={metrics}
            columns={board?.columns ?? []}
            latency={latency}
            onlineUsers={onlineUsers}
          />
        ) : null}
      </section>

      {columnDialog ? (
        <ColumnDialog
          mode={columnDialog.mode}
          column={columnDialog.mode === "edit" ? columnDialog.column : undefined}
          onSubmit={submitColumnDialog}
          onClose={() => setColumnDialog(null)}
        />
      ) : null}

      {taskDialog ? (
        <TaskDialog
          task={taskDialog}
          onSubmit={submitTaskDialog}
          onClose={() => setTaskDialog(null)}
        />
      ) : null}

      {confirmDialog ? (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onClose={() => setConfirmDialog(null)}
        />
      ) : null}
    </main>
  );
}

function App() {
  const [auth, setAuth] = React.useState<AuthState | null>(() => loadAuth());

  const handleAuth = React.useCallback((nextAuth: AuthState) => {
    saveAuth(nextAuth);
    setAuth(nextAuth);
  }, []);

  const handleLogout = React.useCallback(() => {
    clearAuth();
    setAuth(null);
  }, []);

  return auth ? <BoardScreen auth={auth} onLogout={handleLogout} /> : <AuthScreen onAuth={handleAuth} />;
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
