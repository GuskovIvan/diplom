import { Prisma, type ProjectRole, type TaskEvent } from "@prisma/client";
import { hashPassword, type ProjectMembership } from "./auth.js";
import { HttpError } from "./errors.js";
import { prisma } from "./prisma.js";
import { calculateMovePosition, POSITION_STEP } from "./positioning.js";
import { announcementDto, boardDto, columnDto, eventDto, memberDto, projectDto, taskDto, taskGroupDto, userDto } from "./serializers.js";
import { eventIsVisibleToViewer, filterBoardForViewer } from "./visibility.js";

const defaultColumns = [
  { title: "План", description: "Идеи и задачи, которые еще не взяли в работу." },
  { title: "В работе", description: "Задачи, которые сейчас выполняются." },
  { title: "На проверке", description: "Готовые изменения, ожидающие проверки." }
];
function jsonPayload(payload: unknown) {
  return JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue;
}

async function createEvent(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    taskId?: string | null;
    actorId: string;
    type: Prisma.TaskEventCreateInput["type"];
    payload: unknown;
  }
) {
  return tx.taskEvent.create({
    data: {
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      actorId: input.actorId,
      type: input.type,
      payload: jsonPayload(input.payload)
    },
    include: eventInclude
  });
}

async function ensureColumnInProject(columnId: string, projectId: string, tx: Prisma.TransactionClient = prisma) {
  const column = await tx.boardColumn.findUnique({ where: { id: columnId } });
  if (!column || column.projectId !== projectId) {
    throw new HttpError(404, "Column was not found in this project");
  }

  return column;
}

const userSelect = {
  id: true,
  name: true,
  email: true
} as const;

const eventInclude = {
  actor: {
    select: userSelect
  }
} as const;

const memberInclude = {
  user: {
    select: userSelect
  }
} as const;

const groupInclude = {
  members: {
    include: {
      member: {
        include: memberInclude
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  }
} as const;

const announcementInclude = {
  author: {
    select: userSelect
  },
  recipients: {
    include: {
      member: {
        include: memberInclude
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  }
} as const;

const taskInclude = {
  creator: {
    select: userSelect
  },
  assignee: {
    select: userSelect
  },
  completedBy: {
    select: userSelect
  },
  completionRequestedBy: {
    select: userSelect
  },
  assigneeGroup: {
    include: groupInclude
  }
} as const;

async function ensureAssigneeInProject(
  assigneeId: string | null | undefined,
  projectId: string,
  tx: Prisma.TransactionClient
) {
  if (!assigneeId) {
    return null;
  }

  const membership = await tx.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: assigneeId,
        projectId
      }
    }
  });

  if (!membership) {
    throw new HttpError(400, "Task assignee must be a project member");
  }

  return membership;
}

async function ensureAssigneeGroupInProject(
  groupId: string | null | undefined,
  projectId: string,
  tx: Prisma.TransactionClient
) {
  if (!groupId) {
    return null;
  }

  const group = await tx.taskGroup.findUnique({
    where: { id: groupId },
    include: groupInclude
  });

  if (!group || group.projectId !== projectId) {
    throw new HttpError(400, "Task group must belong to this project");
  }

  if (group.members.length === 0) {
    throw new HttpError(400, "Task group must contain at least one member");
  }

  return group;
}

async function ensureGroupMembersInProject(
  memberIds: string[],
  projectId: string,
  tx: Prisma.TransactionClient
) {
  const uniqueMemberIds = [...new Set(memberIds)];
  const members = await tx.projectMember.findMany({
    where: {
      id: {
        in: uniqueMemberIds
      },
      projectId
    },
    include: memberInclude
  });

  if (members.length !== uniqueMemberIds.length) {
    throw new HttpError(400, "Every group member must belong to this project");
  }

  return uniqueMemberIds;
}

function assertSingleAssignee(input: { assigneeId?: string | null; assigneeGroupId?: string | null }) {
  if (input.assigneeId && input.assigneeGroupId) {
    throw new HttpError(400, "Task can be assigned either to a user or to a group");
  }
}

function resolveTaskAssignee(input: {
  currentAssigneeId: string | null;
  currentAssigneeGroupId: string | null;
  assigneeId?: string | null;
  assigneeGroupId?: string | null;
}) {
  let assigneeId = input.assigneeId === undefined ? input.currentAssigneeId : input.assigneeId;
  let assigneeGroupId =
    input.assigneeGroupId === undefined ? input.currentAssigneeGroupId : input.assigneeGroupId;

  if (input.assigneeId) {
    assigneeGroupId = null;
  }
  if (input.assigneeGroupId) {
    assigneeId = null;
  }
  if (input.assigneeId === null && input.assigneeGroupId === null) {
    assigneeId = null;
    assigneeGroupId = null;
  }

  if (assigneeId && assigneeGroupId) {
    throw new HttpError(400, "Task can be assigned either to a user or to a group");
  }

  return { assigneeId, assigneeGroupId };
}

function isUniqueConstraintError(error: unknown, modelName: string) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    error.meta?.modelName === modelName
  );
}

export async function listProjects(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: {
      project: true
    },
    orderBy: {
      project: {
        updatedAt: "desc"
      }
    }
  });

  return memberships.map((membership) => ({
    ...projectDto(membership.project),
    role: membership.role
  }));
}

export async function createProject(input: {
  ownerId: string;
  name: string;
  description?: string;
  emitEvent?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: input.name,
        description: input.description ?? "",
        ownerId: input.ownerId,
        members: {
          create: {
            userId: input.ownerId,
            role: "ADMIN"
          }
        },
        columns: {
          create: defaultColumns.map((column, index) => ({
            title: column.title,
            description: column.description,
            position: index
          }))
        }
      }
    });

    const event = input.emitEvent
      ? await createEvent(tx, {
          projectId: project.id,
          actorId: input.ownerId,
          type: "PROJECT_CREATED",
          payload: projectDto(project)
        })
      : null;

    return {
      project: projectDto(project),
      event
    };
  });
}

export async function deleteProject(projectId: string) {
  await prisma.project.delete({
    where: { id: projectId }
  });
}

export async function listAvailableProjectUsers(projectId: string) {
  const users = await prisma.user.findMany({
    where: {
      memberships: {
        none: {
          projectId
        }
      }
    },
    select: userSelect,
    orderBy: [
      { name: "asc" },
      { email: "asc" }
    ]
  });

  return users.map(userDto);
}

export async function listRegisteredUsers(actorId: string) {
  const users = await prisma.user.findMany({
    where: {
      id: {
        not: actorId
      }
    },
    select: userSelect,
    orderBy: [
      { name: "asc" },
      { email: "asc" }
    ]
  });

  return users.map(userDto);
}

async function createProjectMemberships(
  tx: Prisma.TransactionClient,
  input: {
    projectIds: string[];
    userId: string;
    actorId: string;
    role: ProjectRole;
  }
) {
  const uniqueProjectIds = [...new Set(input.projectIds)];
  const existingMemberships = await tx.projectMember.findMany({
    where: {
      userId: input.userId,
      projectId: {
        in: uniqueProjectIds
      }
    },
    select: {
      projectId: true
    }
  });
  const existingProjectIds = new Set(existingMemberships.map((membership) => membership.projectId));
  const targetProjectIds = uniqueProjectIds.filter((projectId) => !existingProjectIds.has(projectId));
  const members: ReturnType<typeof memberDto>[] = [];
  const events: Awaited<ReturnType<typeof createEvent>>[] = [];

  for (const projectId of targetProjectIds) {
    const member = await tx.projectMember.create({
      data: {
        projectId,
        userId: input.userId,
        role: input.role
      },
      include: memberInclude
    });

    await tx.project.update({
      where: { id: projectId },
      data: { version: { increment: 1 } }
    });

    const memberPayload = memberDto(member);
    members.push(memberPayload);
    events.push(
      await createEvent(tx, {
        projectId,
        actorId: input.actorId,
        type: "MEMBER_ADDED",
        payload: {
          member: memberPayload
        }
      })
    );
  }

  return { members, events };
}

export async function createRegisteredUser(input: {
  actorId: string;
  email: string;
  name: string;
  password: string;
  projectIds: string[];
  role: ProjectRole;
}) {
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const email = input.email.trim().toLowerCase();
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) {
      throw new HttpError(409, "User with this email already exists");
    }

    const user = await tx.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash
      }
    });

    const { members, events } = await createProjectMemberships(tx, {
      projectIds: input.projectIds,
      userId: user.id,
      actorId: input.actorId,
      role: input.role
    });

    return {
      user: userDto(user),
      member: members[0] ?? null,
      members,
      event: events[0] ?? null,
      events
    };
  });
}

export async function addRegisteredUserToProjects(input: {
  actorId: string;
  userId: string;
  projectIds: string[];
  role: ProjectRole;
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new HttpError(404, "User was not found");
    }

    return createProjectMemberships(tx, {
      projectIds: input.projectIds,
      userId: input.userId,
      actorId: input.actorId,
      role: input.role
    });
  });
}

export async function deleteRegisteredUser(input: { actorId: string; userId: string }) {
  if (input.actorId === input.userId) {
    throw new HttpError(409, "You cannot delete your own account");
  }

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new HttpError(404, "User was not found");
    }

    const adminMemberships = await tx.projectMember.findMany({
      where: {
        userId: input.userId,
        role: "ADMIN",
        project: {
          ownerId: {
            not: input.userId
          }
        }
      },
      include: {
        project: true
      }
    });

    for (const membership of adminMemberships) {
      const otherAdmins = await tx.projectMember.count({
        where: {
          projectId: membership.projectId,
          role: "ADMIN",
          userId: {
            not: input.userId
          }
        }
      });

      if (otherAdmins === 0) {
        throw new HttpError(409, `Cannot delete the only administrator of "${membership.project.name}"`);
      }
    }

    await tx.task.updateMany({
      where: {
        creatorId: input.userId
      },
      data: {
        creatorId: input.actorId
      }
    });

    await tx.user.delete({ where: { id: input.userId } });

    return {
      user: userDto(user)
    };
  });
}

export async function addProjectMember(input: {
  projectId: string;
  actorId: string;
  userId: string;
  role: ProjectRole;
}) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new HttpError(404, "User was not found");
    }

    const existing = await tx.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: user.id,
          projectId: input.projectId
        }
      }
    });
    if (existing) {
      throw new HttpError(409, "User is already a project member");
    }

    const member = await tx.projectMember.create({
      data: {
        projectId: input.projectId,
        userId: user.id,
        role: input.role
      },
      include: memberInclude
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    const memberPayload = memberDto(member);
    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "MEMBER_ADDED",
      payload: {
        member: memberPayload
      }
    });

    return {
      member: memberPayload,
      event
    };
  });
}

export async function updateProjectMemberRole(input: {
  projectId: string;
  actorId: string;
  memberId: string;
  role: ProjectRole;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.projectMember.findUnique({ where: { id: input.memberId } });
    if (!current || current.projectId !== input.projectId) {
      throw new HttpError(404, "Project member was not found");
    }

    const member = await tx.projectMember.update({
      where: { id: input.memberId },
      data: { role: input.role },
      include: memberInclude
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    const memberPayload = memberDto(member);
    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "MEMBER_UPDATED",
      payload: {
        member: memberPayload,
        previousRole: current.role,
        nextRole: input.role
      }
    });

    return { member: memberPayload, event };
  });
}

export async function removeProjectMember(input: { projectId: string; actorId: string; memberId: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.projectMember.findUnique({
      where: { id: input.memberId },
      include: memberInclude
    });
    if (!current || current.projectId !== input.projectId) {
      throw new HttpError(404, "Project member was not found");
    }

    await tx.task.updateMany({
      where: {
        projectId: input.projectId,
        assigneeId: current.userId
      },
      data: {
        assigneeId: null
      }
    });
    await tx.projectMember.delete({ where: { id: input.memberId } });
    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "MEMBER_REMOVED",
      payload: {
        member: memberDto(current)
      }
    });

    return { event };
  });
}

export async function createTaskGroup(input: {
  projectId: string;
  actorId: string;
  name: string;
  memberIds: string[];
}) {
  return prisma.$transaction(async (tx) => {
    const memberIds = await ensureGroupMembersInProject(input.memberIds, input.projectId, tx);
    let group;
    try {
      group = await tx.taskGroup.create({
        data: {
          projectId: input.projectId,
          name: input.name,
          members: {
            create: memberIds.map((memberId) => ({ memberId }))
          }
        },
        include: groupInclude
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "TaskGroup")) {
        throw new HttpError(409, "A group with this name already exists in the project");
      }
      throw error;
    }

    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    const groupPayload = taskGroupDto(group);
    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "GROUP_CREATED",
      payload: {
        group: groupPayload
      }
    });

    return { group: groupPayload, event };
  });
}

export async function updateTaskGroup(input: {
  projectId: string;
  actorId: string;
  groupId: string;
  name?: string;
  memberIds?: string[];
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.taskGroup.findUnique({ where: { id: input.groupId } });
    if (!current || current.projectId !== input.projectId) {
      throw new HttpError(404, "Task group was not found");
    }

    const memberIds =
      input.memberIds === undefined
        ? null
        : await ensureGroupMembersInProject(input.memberIds, input.projectId, tx);

    try {
      await tx.taskGroup.update({
        where: { id: input.groupId },
        data: {
          name: input.name
        }
      });
    } catch (error) {
      if (isUniqueConstraintError(error, "TaskGroup")) {
        throw new HttpError(409, "A group with this name already exists in the project");
      }
      throw error;
    }

    if (memberIds) {
      await tx.taskGroupMember.deleteMany({ where: { groupId: input.groupId } });
      await tx.taskGroupMember.createMany({
        data: memberIds.map((memberId) => ({
          groupId: input.groupId,
          memberId
        }))
      });
    }

    const group = await tx.taskGroup.findUnique({
      where: { id: input.groupId },
      include: groupInclude
    });
    if (!group) {
      throw new HttpError(404, "Task group was not found");
    }

    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    const groupPayload = taskGroupDto(group);
    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "GROUP_UPDATED",
      payload: {
        group: groupPayload,
        previousName: current.name
      }
    });

    return { group: groupPayload, event };
  });
}

export async function deleteTaskGroup(input: { projectId: string; actorId: string; groupId: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.taskGroup.findUnique({
      where: { id: input.groupId },
      include: groupInclude
    });
    if (!current || current.projectId !== input.projectId) {
      throw new HttpError(404, "Task group was not found");
    }

    const groupPayload = taskGroupDto(current);
    await tx.taskGroup.delete({ where: { id: input.groupId } });
    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "GROUP_DELETED",
      payload: {
        group: groupPayload
      }
    });

    return { event };
  });
}

async function ensureAnnouncementRecipientsInProject(
  memberIds: string[],
  roles: ProjectRole[],
  projectId: string,
  tx: Prisma.TransactionClient
) {
  const uniqueMemberIds = [...new Set(memberIds)];
  const roleMembers = roles.length > 0
    ? await tx.projectMember.findMany({
        where: {
          projectId,
          role: {
            in: roles
          }
        },
        select: {
          id: true
        }
      })
    : [];
  const targetMemberIds = [...new Set([...uniqueMemberIds, ...roleMembers.map((member) => member.id)])];
  const members = await tx.projectMember.findMany({
    where: {
      id: {
        in: targetMemberIds
      },
      projectId
    }
  });

  if (members.length !== targetMemberIds.length) {
    throw new HttpError(400, "Every announcement recipient must belong to this project");
  }

  if (targetMemberIds.length === 0) {
    throw new HttpError(400, "Choose at least one announcement recipient");
  }

  return targetMemberIds;
}

export async function listAnnouncements(projectId: string, viewer: ProjectMembership, limit = 40) {
  const announcements = await prisma.announcement.findMany({
    where: {
      projectId,
      recipients: {
        some: {
          memberId: viewer.id
        }
      }
    },
    include: announcementInclude,
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100)
  });

  const unreadCount = await prisma.announcementRecipient.count({
    where: {
      memberId: viewer.id,
      readAt: null,
      archivedAt: null,
      announcement: {
        projectId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gte: new Date() } }
        ]
      }
    }
  });

  return {
    announcements: announcements.map((announcement) => announcementDto(announcement, viewer.id)),
    unreadCount
  };
}

export async function createAnnouncement(input: {
  projectId: string;
  authorId: string;
  title: string;
  body?: string;
  priority?: "NORMAL" | "IMPORTANT" | "URGENT";
  expiresAt?: Date | null;
  recipientMemberIds: string[];
  recipientRoles?: ProjectRole[];
}) {
  return prisma.$transaction(async (tx) => {
    const recipientMemberIds = await ensureAnnouncementRecipientsInProject(
      input.recipientMemberIds,
      input.recipientRoles ?? [],
      input.projectId,
      tx
    );

    const announcement = await tx.announcement.create({
      data: {
        projectId: input.projectId,
        authorId: input.authorId,
        title: input.title,
        body: input.body ?? "",
        priority: input.priority ?? "NORMAL",
        expiresAt: input.expiresAt ?? null,
        recipients: {
          create: recipientMemberIds.map((memberId) => ({ memberId }))
        }
      },
      include: announcementInclude
    });

    return announcementDto(announcement);
  });
}

export async function markAnnouncementsRead(projectId: string, viewer: ProjectMembership, announcementId?: string) {
  await prisma.announcementRecipient.updateMany({
    where: {
      memberId: viewer.id,
      readAt: null,
      ...(announcementId ? { announcementId } : {}),
      announcement: {
        projectId
      }
    },
    data: {
      readAt: new Date()
    }
  });
}

export async function acknowledgeAnnouncement(projectId: string, viewer: ProjectMembership, announcementId: string) {
  const result = await prisma.announcementRecipient.updateMany({
    where: {
      memberId: viewer.id,
      announcementId,
      announcement: {
        projectId
      }
    },
    data: {
      readAt: new Date(),
      acknowledgedAt: new Date()
    }
  });

  if (result.count === 0) {
    throw new HttpError(404, "Announcement was not found");
  }
}

export async function archiveAnnouncement(projectId: string, viewer: ProjectMembership, announcementId: string) {
  const result = await prisma.announcementRecipient.updateMany({
    where: {
      memberId: viewer.id,
      announcementId,
      announcement: {
        projectId
      }
    },
    data: {
      archivedAt: new Date()
    }
  });

  if (result.count === 0) {
    throw new HttpError(404, "Announcement was not found");
  }
}

export async function getBoard(projectId: string, viewer?: ProjectMembership) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        include: memberInclude,
        orderBy: {
          createdAt: "asc"
        }
      },
      taskGroups: {
        include: groupInclude,
        orderBy: {
          name: "asc"
        }
      },
      columns: {
        orderBy: {
          position: "asc"
        },
        include: {
          tasks: {
            orderBy: {
              position: "asc"
            },
            include: taskInclude
          }
        }
      }
    }
  });

  if (!project) {
    throw new HttpError(404, "Project was not found");
  }

  return filterBoardForViewer(boardDto(project), viewer);
}

export async function createColumn(input: {
  projectId: string;
  actorId: string;
  title: string;
  description?: string;
}) {
  return prisma.$transaction(async (tx) => {
    const lastColumn = await tx.boardColumn.findFirst({
      where: { projectId: input.projectId },
      orderBy: { position: "desc" }
    });

    const column = await tx.boardColumn.create({
      data: {
        projectId: input.projectId,
        title: input.title,
        description: input.description ?? "",
        position: lastColumn ? lastColumn.position + 1 : 0
      },
      include: {
        tasks: {
          include: taskInclude
        }
      }
    });

    const event = await createEvent(tx, {
      projectId: input.projectId,
      actorId: input.actorId,
      type: "COLUMN_CREATED",
      payload: columnDto(column)
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    return { column: columnDto(column), event };
  });
}

export async function updateColumn(input: {
  columnId: string;
  actorId: string;
  title?: string;
  description?: string;
  position?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.boardColumn.findUnique({ where: { id: input.columnId } });
    if (!current) {
      throw new HttpError(404, "Column was not found");
    }

    const column = await tx.boardColumn.update({
      where: { id: input.columnId },
      data: {
        title: input.title,
        description: input.description,
        position: input.position,
        version: { increment: 1 }
      },
      include: {
        tasks: {
          orderBy: { position: "asc" },
          include: taskInclude
        }
      }
    });

    const event = await createEvent(tx, {
      projectId: column.projectId,
      actorId: input.actorId,
      type: "COLUMN_UPDATED",
      payload: columnDto(column)
    });

    await tx.project.update({
      where: { id: column.projectId },
      data: { version: { increment: 1 } }
    });

    return { column: columnDto(column), event };
  });
}

export async function deleteColumn(input: { columnId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const column = await tx.boardColumn.findUnique({ where: { id: input.columnId } });
    if (!column) {
      throw new HttpError(404, "Column was not found");
    }

    const columnCount = await tx.boardColumn.count({ where: { projectId: column.projectId } });
    if (columnCount <= 1) {
      throw new HttpError(409, "A project must contain at least one column");
    }

    const event = await createEvent(tx, {
      projectId: column.projectId,
      actorId: input.actorId,
      type: "COLUMN_DELETED",
      payload: {
        id: column.id,
        projectId: column.projectId,
        title: column.title
      }
    });

    await tx.boardColumn.delete({ where: { id: input.columnId } });
    await tx.project.update({
      where: { id: column.projectId },
      data: { version: { increment: 1 } }
    });

    return { event };
  });
}

export async function createTask(input: {
  projectId: string;
  actorId: string;
  columnId: string;
  title: string;
  description?: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  assigneeId?: string | null;
  assigneeGroupId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    assertSingleAssignee(input);
    await ensureColumnInProject(input.columnId, input.projectId, tx);
    await ensureAssigneeInProject(input.assigneeId, input.projectId, tx);
    await ensureAssigneeGroupInProject(input.assigneeGroupId, input.projectId, tx);

    const lastTask = await tx.task.findFirst({
      where: { columnId: input.columnId },
      orderBy: { position: "desc" }
    });

    const task = await tx.task.create({
      data: {
        projectId: input.projectId,
        columnId: input.columnId,
        title: input.title,
        description: input.description ?? "",
        priority: input.priority,
        creatorId: input.actorId,
        assigneeId: input.assigneeId ?? null,
        assigneeGroupId: input.assigneeGroupId ?? null,
        position: new Prisma.Decimal(lastTask ? Number(lastTask.position) + POSITION_STEP : POSITION_STEP)
      },
      include: taskInclude
    });

    const taskPayload = taskDto(task);
    const event = await createEvent(tx, {
      projectId: input.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_CREATED",
      payload: taskPayload
    });

    await tx.project.update({
      where: { id: input.projectId },
      data: { version: { increment: 1 } }
    });

    return { task: taskPayload, event };
  });
}

export async function updateTask(input: {
  taskId: string;
  actorId: string;
  title?: string;
  description?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH";
  assigneeId?: string | null;
  assigneeGroupId?: string | null;
  clientVersion?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: input.taskId },
      include: taskInclude
    });
    if (!current) {
      throw new HttpError(404, "Task was not found");
    }

    assertSingleAssignee(input);
    await ensureAssigneeInProject(input.assigneeId, current.projectId, tx);
    await ensureAssigneeGroupInProject(input.assigneeGroupId, current.projectId, tx);
    const nextAssignee = resolveTaskAssignee({
      currentAssigneeId: current.assigneeId,
      currentAssigneeGroupId: current.assigneeGroupId,
      assigneeId: input.assigneeId,
      assigneeGroupId: input.assigneeGroupId
    });

    const conflictResolved = Boolean(input.clientVersion && input.clientVersion < current.version);

    const data: Prisma.TaskUncheckedUpdateInput = {};
    let hasTaskChanges = false;
    if (input.title !== undefined && input.title !== current.title) {
      data.title = input.title;
      hasTaskChanges = true;
    }
    if (input.description !== undefined && input.description !== current.description) {
      data.description = input.description;
      hasTaskChanges = true;
    }
    if (input.priority !== undefined && input.priority !== current.priority) {
      data.priority = input.priority;
      hasTaskChanges = true;
    }
    if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
      data.assigneeId = nextAssignee.assigneeId;
      data.assigneeGroupId = nextAssignee.assigneeGroupId;
      hasTaskChanges = true;
    }
    if (input.assigneeGroupId !== undefined && input.assigneeGroupId !== current.assigneeGroupId) {
      data.assigneeId = nextAssignee.assigneeId;
      data.assigneeGroupId = nextAssignee.assigneeGroupId;
      hasTaskChanges = true;
    }

    if (!hasTaskChanges) {
      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        include: taskInclude
      });
      if (!task) {
        throw new HttpError(404, "Task was not found");
      }

      return { task: taskDto(task), conflictResolved: false, event: null };
    }

    data.version = { increment: 1 };

    const task = await tx.task.update({
      where: { id: input.taskId },
      data,
      include: taskInclude
    });

    const payload = {
      task: taskDto(task),
      previousTask: taskDto(current),
      conflict: {
        resolved: conflictResolved,
        strategy: "LAST_WRITE_WINS",
        clientVersion: input.clientVersion ?? null,
        previousServerVersion: current.version
      }
    };

    const event = await createEvent(tx, {
      projectId: task.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_UPDATED",
      payload
    });

    await tx.project.update({
      where: { id: task.projectId },
      data: { version: { increment: 1 } }
    });

    return { task: taskDto(task), conflictResolved, event };
  });
}

export async function deleteTask(input: { taskId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: input.taskId },
      include: taskInclude
    });
    if (!task) {
      throw new HttpError(404, "Task was not found");
    }

    const event = await createEvent(tx, {
      projectId: task.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_DELETED",
      payload: {
        task: taskDto(task)
      }
    });

    await tx.task.delete({ where: { id: input.taskId } });
    await tx.project.update({
      where: { id: task.projectId },
      data: { version: { increment: 1 } }
    });

    return { event };
  });
}

export async function requestTaskCompletion(input: { taskId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: input.taskId },
      include: taskInclude
    });
    if (!current) {
      throw new HttpError(404, "Task was not found");
    }
    if (current.isCompleted) {
      throw new HttpError(409, "Task is already completed");
    }

    const actorMembership = await tx.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: input.actorId,
          projectId: current.projectId
        }
      },
      include: memberInclude
    });
    if (!actorMembership) {
      throw new HttpError(403, "Only project members can submit tasks for completion");
    }
    if (actorMembership.role !== "MEMBER") {
      throw new HttpError(403, "Only project participants can submit tasks for completion");
    }

    if (current.completionRequestedAt) {
      return { task: taskDto(current), event: null, announcement: null };
    }

    const requestedAt = new Date();
    const task = await tx.task.update({
      where: { id: input.taskId },
      data: {
        completionRequestedAt: requestedAt,
        completionRequestedById: input.actorId,
        version: { increment: 1 }
      },
      include: taskInclude
    });
    const taskPayload = taskDto(task);

    const event = await createEvent(tx, {
      projectId: task.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_COMPLETION_REQUESTED",
      payload: {
        task: taskPayload,
        previousTask: taskDto(current),
        requestedBy: memberDto(actorMembership)
      }
    });

    const creatorMembership = await tx.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: current.creatorId,
          projectId: current.projectId
        }
      },
      include: memberInclude
    });
    const announcement = creatorMembership?.role === "ADMIN"
      ? await tx.announcement.create({
          data: {
            projectId: current.projectId,
            authorId: input.actorId,
            title: `Задача «${current.title}» выполнена`,
            body: `${actorMembership.user.name} сообщает, что работа по задаче «${current.title}» выполнена.`,
            priority: "IMPORTANT",
            recipients: {
              create: [{ memberId: creatorMembership.id }]
            }
          },
          include: announcementInclude
        })
      : null;

    await tx.project.update({
      where: { id: task.projectId },
      data: { version: { increment: 1 } }
    });

    return {
      task: taskPayload,
      event,
      announcement: announcement ? announcementDto(announcement, creatorMembership?.id) : null
    };
  });
}

export async function completeTask(input: { taskId: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: input.taskId },
      include: taskInclude
    });
    if (!current) {
      throw new HttpError(404, "Task was not found");
    }

    if (current.isCompleted) {
      return { task: taskDto(current), event: null };
    }
    if (!current.completionRequestedAt) {
      throw new HttpError(409, "Task has not been submitted for completion yet");
    }

    const lastCompletedTask = await tx.task.findFirst({
      where: {
        columnId: current.columnId,
        isCompleted: true
      },
      orderBy: [
        { completedPosition: "desc" },
        { completedAt: "desc" }
      ]
    });
    const completedPosition = (lastCompletedTask?.completedPosition ?? 0) + 1;

    const task = await tx.task.update({
      where: { id: input.taskId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        completedPosition,
        completedById: input.actorId,
        version: { increment: 1 }
      },
      include: taskInclude
    });

    const taskPayload = taskDto(task);
    const event = await createEvent(tx, {
      projectId: task.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_COMPLETED",
      payload: {
        task: taskPayload,
        previousTask: taskDto(current)
      }
    });

    await tx.project.update({
      where: { id: task.projectId },
      data: { version: { increment: 1 } }
    });

    return { task: taskPayload, event };
  });
}

export async function moveCompletedTask(input: {
  taskId: string;
  actorId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: input.taskId },
      include: taskInclude
    });
    if (!current) {
      throw new HttpError(404, "Task was not found");
    }
    if (!current.isCompleted) {
      throw new HttpError(409, "Only completed tasks can be reordered on the roadmap");
    }

    const completedTasks = await tx.task.findMany({
      where: {
        columnId: current.columnId,
        isCompleted: true
      },
      orderBy: [
        { completedPosition: "asc" },
        { completedAt: "asc" },
        { createdAt: "asc" }
      ],
      select: {
        id: true,
        completedPosition: true
      }
    });

    const completedTaskIds = new Set(completedTasks.map((task) => task.id));
    if (input.beforeTaskId && !completedTaskIds.has(input.beforeTaskId)) {
      throw new HttpError(400, "beforeTaskId must point to a completed task in the same roadmap column");
    }
    if (input.afterTaskId && !completedTaskIds.has(input.afterTaskId)) {
      throw new HttpError(400, "afterTaskId must point to a completed task in the same roadmap column");
    }
    if (input.beforeTaskId === current.id || input.afterTaskId === current.id) {
      throw new HttpError(400, "Move anchor cannot be the moved task itself");
    }

    const orderedTaskIds = completedTasks.filter((task) => task.id !== current.id).map((task) => task.id);
    let insertIndex = orderedTaskIds.length;
    if (input.beforeTaskId) {
      insertIndex = orderedTaskIds.indexOf(input.beforeTaskId);
    } else if (input.afterTaskId) {
      insertIndex = orderedTaskIds.indexOf(input.afterTaskId) + 1;
    }
    orderedTaskIds.splice(insertIndex, 0, current.id);

    const previousPosition = completedTasks.findIndex((task) => task.id === current.id) + 1;
    const nextPosition = orderedTaskIds.indexOf(current.id) + 1;
    if (previousPosition === nextPosition) {
      return { task: taskDto(current), event: null };
    }

    for (const [index, taskId] of orderedTaskIds.entries()) {
      await tx.task.update({
        where: { id: taskId },
        data: {
          completedPosition: index + 1,
          ...(taskId === current.id ? { version: { increment: 1 } } : {})
        }
      });
    }

    const task = await tx.task.findUnique({
      where: { id: current.id },
      include: taskInclude
    });
    if (!task) {
      throw new HttpError(404, "Task was not found");
    }

    const taskPayload = taskDto(task);
    const event = await createEvent(tx, {
      projectId: task.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_ROADMAP_MOVED",
      payload: {
        task: taskPayload,
        previous: {
          completedPosition: previousPosition
        },
        current: {
          completedPosition: nextPosition
        }
      }
    });

    await tx.project.update({
      where: { id: task.projectId },
      data: { version: { increment: 1 } }
    });

    return { task: taskPayload, event };
  });
}

export async function moveTask(input: {
  taskId: string;
  actorId: string;
  columnId: string;
  beforeTaskId?: string | null;
  afterTaskId?: string | null;
  clientVersion?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.task.findUnique({
      where: { id: input.taskId },
      include: taskInclude
    });

    if (!current) {
      throw new HttpError(404, "Task was not found");
    }
    if (current.isCompleted) {
      throw new HttpError(409, "Completed tasks can only be reordered on the roadmap");
    }

    const targetColumn = await ensureColumnInProject(input.columnId, current.projectId, tx);
    const sourceColumn =
      current.columnId === input.columnId
        ? targetColumn
        : await ensureColumnInProject(current.columnId, current.projectId, tx);

    const targetColumnTasks = await tx.task.findMany({
      where: { columnId: input.columnId },
      orderBy: { position: "asc" },
      select: { id: true, position: true }
    });

    const targetTaskIds = new Set(targetColumnTasks.map((task) => task.id));
    if (input.beforeTaskId && !targetTaskIds.has(input.beforeTaskId)) {
      throw new HttpError(400, "beforeTaskId must point to a task in the target column");
    }
    if (input.afterTaskId && !targetTaskIds.has(input.afterTaskId)) {
      throw new HttpError(400, "afterTaskId must point to a task in the target column");
    }
    if (input.beforeTaskId === current.id || input.afterTaskId === current.id) {
      throw new HttpError(400, "Move anchor cannot be the moved task itself");
    }

    const nextPosition = calculateMovePosition({
      items: targetColumnTasks,
      movingId: current.id,
      beforeTaskId: input.beforeTaskId,
      afterTaskId: input.afterTaskId
    });

    const conflictResolved = Boolean(input.clientVersion && input.clientVersion < current.version);

    if (input.columnId === current.columnId && nextPosition === Number(current.position)) {
      return { task: taskDto(current), conflictResolved: false, event: null };
    }

    const task = await tx.task.update({
      where: { id: input.taskId },
      data: {
        columnId: input.columnId,
        position: new Prisma.Decimal(nextPosition),
        version: { increment: 1 }
      },
      include: taskInclude
    });

    const payload = {
      task: taskDto(task),
      previous: {
        columnId: current.columnId,
        columnTitle: sourceColumn.title,
        position: Number(current.position),
        version: current.version
      },
      current: {
        columnId: task.columnId,
        columnTitle: targetColumn.title,
        position: Number(task.position),
        version: task.version
      },
      conflict: {
        resolved: conflictResolved,
        strategy: "LAST_WRITE_WINS",
        clientVersion: input.clientVersion ?? null,
        previousServerVersion: current.version
      }
    };

    const event = await createEvent(tx, {
      projectId: task.projectId,
      taskId: task.id,
      actorId: input.actorId,
      type: "TASK_MOVED",
      payload
    });

    await tx.project.update({
      where: { id: task.projectId },
      data: { version: { increment: 1 } }
    });

    return {
      task: taskDto(task),
      conflictResolved,
      event
    };
  });
}

export async function listEvents(projectId: string, limit = 40, viewer?: ProjectMembership) {
  const events = await prisma.taskEvent.findMany({
    where: { projectId },
    include: eventInclude,
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100)
  });

  return events.map(eventDto).filter((event) => eventIsVisibleToViewer(event, viewer));
}

export async function getRealtimeMetrics(projectId: string) {
  const [eventsCount, lastEvents] = await Promise.all([
    prisma.taskEvent.count({ where: { projectId } }),
    prisma.taskEvent.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 10
    })
  ]);

  return {
    projectId,
    eventsCount,
    lastEventAt: lastEvents[0]?.createdAt ?? null,
    recentEventTypes: lastEvents.map((event: TaskEvent) => event.type)
  };
}
