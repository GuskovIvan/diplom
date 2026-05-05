import type { Express, Request } from "express";
import { Router } from "express";
import {
  assertProjectAdmin,
  comparePassword,
  hashPassword,
  isProjectAdminRole,
  requireAuth,
  requireProjectCreationAccess,
  requireProjectAdmin,
  requireProjectMember,
  requireProjectOwner,
  signToken,
  type AuthenticatedRequest
} from "./auth.js";
import {
  announcementCreateSchema,
  columnCreateSchema,
  columnUpdateSchema,
  loginSchema,
  memberCreateSchema,
  memberUpdateSchema,
  projectSchema,
  registerSchema,
  taskGroupCreateSchema,
  taskGroupUpdateSchema,
  taskCreateSchema,
  taskMoveSchema,
  taskUpdateSchema
} from "./schemas.js";
import { HttpError, asyncRoute } from "./errors.js";
import { prisma } from "./prisma.js";
import {
  createColumn,
  createProject,
  createTask,
  createTaskGroup,
  deleteColumn,
  deleteTaskGroup,
  deleteTask,
  getBoard,
  getRealtimeMetrics,
  acknowledgeAnnouncement,
  archiveAnnouncement,
  addProjectMember,
  createAnnouncement,
  listEvents,
  listAnnouncements,
  listProjects,
  markAnnouncementsRead,
  moveTask,
  removeProjectMember,
  updateTaskGroup,
  updateProjectMemberRole,
  updateColumn,
  updateTask
} from "./board.service.js";
import { userDto } from "./serializers.js";
import { publishAnnouncement, publishProjectEvent, type RealtimeServer } from "./realtime.js";

function authReq(req: Request) {
  return req as AuthenticatedRequest;
}

function realtime(req: Request) {
  return req.app.get("io") as RealtimeServer;
}

function publish(req: Request, event: Parameters<typeof publishProjectEvent>[1] | null) {
  if (event) {
    publishProjectEvent(realtime(req), event);
  }
}

function routeParam(req: Request, name: string) {
  const value = req.params[name];
  if (typeof value !== "string") {
    throw new HttpError(400, `Invalid route parameter: ${name}`);
  }

  return value;
}

async function getProjectMemberForRoute(projectId: string, memberId: string) {
  const member = await prisma.projectMember.findUnique({ where: { id: memberId } });
  if (!member || member.projectId !== projectId) {
    throw new HttpError(404, "Project member was not found");
  }

  return member;
}

type ProjectMembership = Awaited<ReturnType<typeof requireProjectMember>>;

type AssignmentInput = {
  assigneeId?: string | null;
  assigneeGroupId?: string | null;
};

function assertActorCanTargetRoles(actor: ProjectMembership, roles: string[]) {
  if (roles.includes("OWNER")) {
    throw new HttpError(403, "Tasks cannot be assigned to the project owner");
  }

  if (actor.role === "OWNER") {
    return;
  }

  if (actor.role === "ADMIN" && roles.every((role) => role === "MEMBER")) {
    return;
  }

  throw new HttpError(403, "Administrators can assign tasks only to regular project members");
}

async function getAssignmentTargetRoles(projectId: string, assignment: AssignmentInput) {
  if (assignment.assigneeId && assignment.assigneeGroupId) {
    throw new HttpError(400, "Task can be assigned either to a user or to a group");
  }

  if (assignment.assigneeId) {
    const member = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: assignment.assigneeId,
          projectId
        }
      }
    });
    if (!member) {
      throw new HttpError(400, "Task assignee must be a project member");
    }

    return [member.role];
  }

  if (assignment.assigneeGroupId) {
    const group = await prisma.taskGroup.findUnique({
      where: { id: assignment.assigneeGroupId },
      include: {
        members: {
          include: {
            member: true
          }
        }
      }
    });
    if (!group || group.projectId !== projectId) {
      throw new HttpError(400, "Task group must belong to this project");
    }
    if (group.members.length === 0) {
      throw new HttpError(400, "Task group must contain at least one member");
    }

    return group.members.map((item) => item.member.role);
  }

  return [];
}

async function getMemberTargetRoles(projectId: string, memberIds: string[]) {
  const uniqueMemberIds = [...new Set(memberIds)];
  const members = await prisma.projectMember.findMany({
    where: {
      projectId,
      id: {
        in: uniqueMemberIds
      }
    }
  });

  if (members.length !== uniqueMemberIds.length) {
    throw new HttpError(400, "Every group member must belong to this project");
  }

  return members.map((member) => member.role);
}

async function assertTaskAssignmentAllowed(
  actor: ProjectMembership,
  projectId: string,
  assignment: AssignmentInput
) {
  if (assignment.assigneeId === undefined && assignment.assigneeGroupId === undefined) {
    return;
  }

  const roles = await getAssignmentTargetRoles(projectId, assignment);
  if (roles.length === 0) {
    return;
  }

  assertActorCanTargetRoles(actor, roles);
}

async function assertTaskGroupAllowed(
  actor: ProjectMembership,
  projectId: string,
  memberIds: string[]
) {
  const roles = await getMemberTargetRoles(projectId, memberIds);
  assertActorCanTargetRoles(actor, roles);
}

async function assertExistingTaskGroupAllowed(actor: ProjectMembership, projectId: string, groupId: string) {
  const group = await prisma.taskGroup.findUnique({
    where: { id: groupId },
    include: {
      members: {
        include: {
          member: true
        }
      }
    }
  });
  if (!group || group.projectId !== projectId) {
    throw new HttpError(404, "Task group was not found");
  }

  assertActorCanTargetRoles(actor, group.members.map((item) => item.member.role));
}

async function assertTaskMovableByMembership(
  membership: ProjectMembership,
  task: { assigneeId: string | null; assigneeGroupId: string | null }
) {
  if (isProjectAdminRole(membership.role) || task.assigneeId === membership.userId) {
    return;
  }

  if (task.assigneeGroupId) {
    const groupMember = await prisma.taskGroupMember.findUnique({
      where: {
        groupId_memberId: {
          groupId: task.assigneeGroupId,
          memberId: membership.id
        }
      }
    });
    if (groupMember) {
      return;
    }
  }

  throw new HttpError(403, "Members can move only tasks assigned to them or their group");
}

export function registerRoutes(app: Express) {
  const router = Router();

  router.get(
    "/health",
    asyncRoute(async (_req, res) => {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, database: "postgresql" });
    })
  );

  router.post(
    "/auth/register",
    asyncRoute(async (req, res) => {
      const input = registerSchema.parse(req.body);
      const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
      if (existingUser) {
        throw new HttpError(409, "User with this email already exists");
      }

      const user = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash: await hashPassword(input.password)
        }
      });

      const { project } = await createProject({
        ownerId: user.id,
        name: "Дипломная доска задач",
        description: "Демо-проект для проверки REST API, WebSocket и синхронизации задач."
      });

      res.status(201).json({
        token: signToken(user),
        user: userDto(user),
        project
      });
    })
  );

  router.post(
    "/auth/login",
    asyncRoute(async (req, res) => {
      const input = loginSchema.parse(req.body);
      const user = await prisma.user.findUnique({ where: { email: input.email } });
      if (!user || !(await comparePassword(input.password, user.passwordHash))) {
        throw new HttpError(401, "Invalid email or password");
      }

      res.json({
        token: signToken(user),
        user: userDto(user)
      });
    })
  );

  router.use(requireAuth);

  router.get("/auth/me", (req, res) => {
    res.json({ user: authReq(req).user });
  });

  router.get(
    "/projects",
    asyncRoute(async (req, res) => {
      res.json({ projects: await listProjects(authReq(req).user.id) });
    })
  );

  router.post(
    "/projects",
    asyncRoute(async (req, res) => {
      await requireProjectCreationAccess(authReq(req).user.id);
      const input = projectSchema.parse(req.body);
      const result = await createProject({
        ownerId: authReq(req).user.id,
        name: input.name,
        description: input.description,
        emitEvent: true
      });
      publish(req, result.event);
      res.status(201).json({ project: result.project });
    })
  );

  router.get(
    "/projects/:projectId/board",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      res.json({ board: await getBoard(projectId, membership) });
    })
  );

  router.get(
    "/projects/:projectId/events",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      const limit = Number(req.query.limit ?? 40);
      res.json({ events: await listEvents(projectId, limit, membership) });
    })
  );

  router.get(
    "/projects/:projectId/announcements",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      const limit = Number(req.query.limit ?? 40);
      res.json(await listAnnouncements(projectId, membership, limit));
    })
  );

  router.post(
    "/projects/:projectId/announcements",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      await requireProjectAdmin(projectId, authReq(req).user.id);
      const input = announcementCreateSchema.parse(req.body);
      const announcement = await createAnnouncement({
        projectId,
        authorId: authReq(req).user.id,
        title: input.title,
        body: input.body,
        priority: input.priority,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        recipientMemberIds: input.recipientMemberIds,
        recipientRoles: input.recipientRoles
      });
      publishAnnouncement(realtime(req), announcement);
      res.status(201).json({ announcement });
    })
  );

  router.post(
    "/projects/:projectId/announcements/read",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      await markAnnouncementsRead(projectId, membership);
      res.status(204).send();
    })
  );

  router.post(
    "/projects/:projectId/announcements/:announcementId/read",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const announcementId = routeParam(req, "announcementId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      await markAnnouncementsRead(projectId, membership, announcementId);
      res.status(204).send();
    })
  );

  router.post(
    "/projects/:projectId/announcements/:announcementId/acknowledge",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const announcementId = routeParam(req, "announcementId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      await acknowledgeAnnouncement(projectId, membership, announcementId);
      res.status(204).send();
    })
  );

  router.post(
    "/projects/:projectId/announcements/:announcementId/archive",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const announcementId = routeParam(req, "announcementId");
      const membership = await requireProjectMember(projectId, authReq(req).user.id);
      await archiveAnnouncement(projectId, membership, announcementId);
      res.status(204).send();
    })
  );

  router.get(
    "/projects/:projectId/metrics",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      await requireProjectMember(projectId, authReq(req).user.id);
      res.json({ metrics: await getRealtimeMetrics(projectId) });
    })
  );

  router.post(
    "/projects/:projectId/columns",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      await requireProjectAdmin(projectId, authReq(req).user.id);
      const input = columnCreateSchema.parse(req.body);
      const result = await createColumn({
        projectId,
        actorId: authReq(req).user.id,
        title: input.title,
        description: input.description
      });
      publish(req, result.event);
      res.status(201).json({ column: result.column });
    })
  );

  router.patch(
    "/columns/:columnId",
    asyncRoute(async (req, res) => {
      const columnId = routeParam(req, "columnId");
      const current = await prisma.boardColumn.findUnique({ where: { id: columnId } });
      if (!current) {
        throw new HttpError(404, "Column was not found");
      }
      await requireProjectAdmin(current.projectId, authReq(req).user.id);

      const input = columnUpdateSchema.parse(req.body);
      const result = await updateColumn({
        columnId,
        actorId: authReq(req).user.id,
        ...input
      });
      publish(req, result.event);
      res.json({ column: result.column });
    })
  );

  router.delete(
    "/columns/:columnId",
    asyncRoute(async (req, res) => {
      const columnId = routeParam(req, "columnId");
      const current = await prisma.boardColumn.findUnique({ where: { id: columnId } });
      if (!current) {
        throw new HttpError(404, "Column was not found");
      }
      await requireProjectAdmin(current.projectId, authReq(req).user.id);

      const result = await deleteColumn({
        columnId,
        actorId: authReq(req).user.id
      });
      publish(req, result.event);
      res.status(204).send();
    })
  );

  router.post(
    "/projects/:projectId/members",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const input = memberCreateSchema.parse(req.body);
      if (input.role === "ADMIN") {
        await requireProjectOwner(projectId, authReq(req).user.id);
      } else {
        await requireProjectAdmin(projectId, authReq(req).user.id);
      }

      const result = await addProjectMember({
        projectId,
        actorId: authReq(req).user.id,
        email: input.email,
        name: input.name,
        password: input.password,
        role: input.role
      });
      publish(req, result.event);
      res.status(201).json({
        member: result.member,
        createdUser: result.createdUser,
        temporaryPassword: result.temporaryPassword
      });
    })
  );

  router.patch(
    "/projects/:projectId/members/:memberId",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const memberId = routeParam(req, "memberId");
      const input = memberUpdateSchema.parse(req.body);
      const target = await getProjectMemberForRoute(projectId, memberId);
      await requireProjectOwner(projectId, authReq(req).user.id);

      if (target.userId === authReq(req).user.id) {
        throw new HttpError(409, "Project owner cannot change their own role here");
      }

      const member = await updateProjectMemberRole({
        projectId,
        actorId: authReq(req).user.id,
        memberId,
        role: input.role
      });
      publish(req, member.event);
      res.json({ member: member.member });
    })
  );

  router.delete(
    "/projects/:projectId/members/:memberId",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const memberId = routeParam(req, "memberId");
      const target = await getProjectMemberForRoute(projectId, memberId);
      const actor = await requireProjectMember(projectId, authReq(req).user.id);

      if (target.userId === authReq(req).user.id) {
        throw new HttpError(409, "You cannot remove yourself from the project");
      }

      if (target.role === "ADMIN") {
        await requireProjectOwner(projectId, authReq(req).user.id);
      } else {
        assertProjectAdmin(actor);
      }

      const result = await removeProjectMember({
        projectId,
        actorId: authReq(req).user.id,
        memberId
      });
      publish(req, result.event);
      res.status(204).send();
    })
  );

  router.post(
    "/projects/:projectId/groups",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const actor = await requireProjectAdmin(projectId, authReq(req).user.id);
      const input = taskGroupCreateSchema.parse(req.body);
      await assertTaskGroupAllowed(actor, projectId, input.memberIds);

      const group = await createTaskGroup({
        projectId,
        actorId: authReq(req).user.id,
        name: input.name,
        memberIds: input.memberIds
      });

      publish(req, group.event);
      res.status(201).json({ group: group.group });
    })
  );

  router.patch(
    "/projects/:projectId/groups/:groupId",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const groupId = routeParam(req, "groupId");
      const actor = await requireProjectAdmin(projectId, authReq(req).user.id);
      const input = taskGroupUpdateSchema.parse(req.body);
      await assertExistingTaskGroupAllowed(actor, projectId, groupId);
      if (input.memberIds) {
        await assertTaskGroupAllowed(actor, projectId, input.memberIds);
      }

      const group = await updateTaskGroup({
        projectId,
        actorId: authReq(req).user.id,
        groupId,
        name: input.name,
        memberIds: input.memberIds
      });

      publish(req, group.event);
      res.json({ group: group.group });
    })
  );

  router.delete(
    "/projects/:projectId/groups/:groupId",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const groupId = routeParam(req, "groupId");
      const actor = await requireProjectAdmin(projectId, authReq(req).user.id);
      await assertExistingTaskGroupAllowed(actor, projectId, groupId);

      const result = await deleteTaskGroup({
        projectId,
        actorId: authReq(req).user.id,
        groupId
      });
      publish(req, result.event);
      res.status(204).send();
    })
  );

  router.post(
    "/projects/:projectId/tasks",
    asyncRoute(async (req, res) => {
      const projectId = routeParam(req, "projectId");
      const actor = await requireProjectAdmin(projectId, authReq(req).user.id);
      const input = taskCreateSchema.parse(req.body);
      await assertTaskAssignmentAllowed(actor, projectId, input);
      const result = await createTask({
        projectId,
        actorId: authReq(req).user.id,
        ...input
      });
      publish(req, result.event);
      res.status(201).json({ task: result.task });
    })
  );

  router.patch(
    "/tasks/:taskId",
    asyncRoute(async (req, res) => {
      const taskId = routeParam(req, "taskId");
      const current = await prisma.task.findUnique({ where: { id: taskId } });
      if (!current) {
        throw new HttpError(404, "Task was not found");
      }
      const membership = await requireProjectMember(current.projectId, authReq(req).user.id);

      const input = taskUpdateSchema.parse(req.body);
      assertProjectAdmin(membership);
      await assertTaskAssignmentAllowed(membership, current.projectId, input);
      const result = await updateTask({
        taskId,
        actorId: authReq(req).user.id,
        ...input
      });
      publish(req, result.event);
      res.json({
        task: result.task,
        conflictResolved: result.conflictResolved
      });
    })
  );

  router.post(
    "/tasks/:taskId/move",
    asyncRoute(async (req, res) => {
      const taskId = routeParam(req, "taskId");
      const current = await prisma.task.findUnique({ where: { id: taskId } });
      if (!current) {
        throw new HttpError(404, "Task was not found");
      }
      const membership = await requireProjectMember(current.projectId, authReq(req).user.id);
      await assertTaskMovableByMembership(membership, current);

      const input = taskMoveSchema.parse(req.body);
      const result = await moveTask({
        taskId,
        actorId: authReq(req).user.id,
        ...input
      });
      publish(req, result.event);
      res.json({
        task: result.task,
        conflictResolved: result.conflictResolved
      });
    })
  );

  router.delete(
    "/tasks/:taskId",
    asyncRoute(async (req, res) => {
      const taskId = routeParam(req, "taskId");
      const current = await prisma.task.findUnique({ where: { id: taskId } });
      if (!current) {
        throw new HttpError(404, "Task was not found");
      }
      await requireProjectAdmin(current.projectId, authReq(req).user.id);

      const result = await deleteTask({
        taskId,
        actorId: authReq(req).user.id
      });
      publish(req, result.event);
      res.status(204).send();
    })
  );

  app.use("/api", router);
}
