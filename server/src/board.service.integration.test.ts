import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { io as createSocketClient } from "socket.io-client";
import {
  addProjectMember,
  completeTask,
  createProject,
  createTask,
  createTaskGroup,
  deleteTaskGroup,
  getBoard,
  listAnnouncements,
  listEvents,
  moveCompletedTask,
  moveTask,
  requestTaskCompletion,
  removeProjectMember,
  updateProjectMemberRole,
  updateTask,
  updateTaskGroup
} from "./board.service.js";
import { hashPassword, signToken } from "./auth.js";
import { prisma } from "./prisma.js";
import { createRealtimeServer, publishProjectEvent } from "./realtime.js";

const testRunId = randomUUID();
const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

async function createTestUser(label: string) {
  const userId = randomUUID();
  const user = await prisma.user.create({
    data: {
      email: `${label}-${userId}-${testRunId}@example.com`,
      name: `Test ${label}`,
      passwordHash: await hashPassword("test-password-123")
    }
  });
  createdUserIds.push(user.id);
  return user;
}

async function addRegisteredMember(input: {
  projectId: string;
  actorId: string;
  label: string;
  role: "ADMIN" | "MEMBER";
}) {
  const user = await createTestUser(input.label);
  return addProjectMember({
    projectId: input.projectId,
    actorId: input.actorId,
    userId: user.id,
    role: input.role
  });
}

async function createProjectFixture() {
  const owner = await createTestUser("owner");
  const result = await createProject({
    ownerId: owner.id,
    name: `Integration board ${testRunId}`,
    description: "Temporary board for automated integration tests",
    emitEvent: true
  });
  createdProjectIds.push(result.project.id);

  return {
    owner,
    project: result.project
  };
}

function waitForSocketEvent<T>(socket: ReturnType<typeof createSocketClient>, eventName: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(eventName);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, 2000);

    socket.once(eventName, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function listen(server: ReturnType<typeof createServer>) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Unexpected test server address");
      }
      resolve(address.port);
    });
  });
}

function closeRealtimeServer(ioServer: ReturnType<typeof createRealtimeServer>) {
  return new Promise<void>((resolve, reject) => {
    ioServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function taskTitleFromEventPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const value = payload as {
    title?: unknown;
    task?: { title?: unknown };
    previousTask?: { title?: unknown };
  };

  if (typeof value.task?.title === "string") {
    return value.task.title;
  }

  if (typeof value.title === "string") {
    return value.title;
  }

  if (typeof value.previousTask?.title === "string") {
    return value.previousTask.title;
  }

  return null;
}

describe.sequential("board collaboration integration", () => {
  afterAll(async () => {
    await prisma.project.deleteMany({
      where: {
        id: {
          in: createdProjectIds
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        OR: [
          {
            id: {
              in: createdUserIds
            }
          },
          {
            email: {
              endsWith: `${testRunId}@example.com`
            }
          }
        ]
      }
    });
    await prisma.$disconnect();
  });

  it("records project events for members and task groups", async () => {
    const { owner, project } = await createProjectFixture();

    const added = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "worker",
      role: "MEMBER"
    });
    expect(added.event.type).toBe("MEMBER_ADDED");
    expect(added.member.role).toBe("MEMBER");

    const updatedMember = await updateProjectMemberRole({
      projectId: project.id,
      actorId: owner.id,
      memberId: added.member.id,
      role: "ADMIN"
    });
    expect(updatedMember.event.type).toBe("MEMBER_UPDATED");
    expect(updatedMember.member.role).toBe("ADMIN");

    const createdGroup = await createTaskGroup({
      projectId: project.id,
      actorId: owner.id,
      name: "Review group",
      memberIds: [added.member.id]
    });
    expect(createdGroup.event.type).toBe("GROUP_CREATED");
    expect(createdGroup.group.members).toHaveLength(1);

    const updatedGroup = await updateTaskGroup({
      projectId: project.id,
      actorId: owner.id,
      groupId: createdGroup.group.id,
      name: "Review group updated",
      memberIds: [added.member.id]
    });
    expect(updatedGroup.event.type).toBe("GROUP_UPDATED");
    expect(updatedGroup.group.name).toBe("Review group updated");

    const deletedGroup = await deleteTaskGroup({
      projectId: project.id,
      actorId: owner.id,
      groupId: createdGroup.group.id
    });
    expect(deletedGroup.event.type).toBe("GROUP_DELETED");

    const removedMember = await removeProjectMember({
      projectId: project.id,
      actorId: owner.id,
      memberId: added.member.id
    });
    expect(removedMember.event.type).toBe("MEMBER_REMOVED");

    const eventTypes = await prisma.taskEvent.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
      select: { type: true }
    });
    expect(eventTypes.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "MEMBER_ADDED",
        "MEMBER_UPDATED",
        "GROUP_CREATED",
        "GROUP_UPDATED",
        "GROUP_DELETED",
        "MEMBER_REMOVED"
      ])
    );
  });

  it("increments task version and marks stale moves as resolved conflicts", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const sourceColumn = board.columns[0];
    const targetColumn = board.columns[1];

    const created = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: sourceColumn.id,
      title: "Versioned move",
      description: "A move should increment version",
      priority: "HIGH"
    });

    const firstMove = await moveTask({
      taskId: created.task.id,
      actorId: owner.id,
      columnId: targetColumn.id,
      clientVersion: created.task.version
    });
    expect(firstMove.conflictResolved).toBe(false);
    expect(firstMove.task.version).toBe(created.task.version + 1);
    expect(firstMove.event?.type).toBe("TASK_MOVED");
    expect(firstMove.event?.payload).toMatchObject({
      previous: {
        columnId: sourceColumn.id,
        columnTitle: sourceColumn.title
      },
      current: {
        columnId: targetColumn.id,
        columnTitle: targetColumn.title
      }
    });

    const staleMove = await moveTask({
      taskId: created.task.id,
      actorId: owner.id,
      columnId: sourceColumn.id,
      clientVersion: created.task.version
    });
    expect(staleMove.conflictResolved).toBe(true);
    expect(staleMove.task.version).toBe(firstMove.task.version + 1);
    expect(staleMove.event?.payload).toMatchObject({
      conflict: {
        resolved: true,
        strategy: "LAST_WRITE_WINS"
      }
    });
  });

  it("supports reordering tasks inside one column", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const column = board.columns[0];

    const first = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "First",
      priority: "MEDIUM"
    });
    const second = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "Second",
      priority: "MEDIUM"
    });
    const third = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "Third",
      priority: "MEDIUM"
    });

    const moved = await moveTask({
      taskId: third.task.id,
      actorId: owner.id,
      columnId: column.id,
      beforeTaskId: second.task.id,
      clientVersion: third.task.version
    });

    expect(moved.event?.type).toBe("TASK_MOVED");
    expect(moved.task.columnId).toBe(column.id);
    expect(moved.task.position).toBeGreaterThan(first.task.position);
    expect(moved.task.position).toBeLessThan(second.task.position);
    expect(moved.task.version).toBe(third.task.version + 1);
  });

  it("moves completed tasks from the board into ordered roadmap items", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const column = board.columns[0];
    const worker = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "completion-requester",
      role: "MEMBER"
    });

    const first = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "First completed task",
      priority: "MEDIUM",
      assigneeId: worker.member.user.id
    });
    const second = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "Second completed task",
      priority: "HIGH",
      assigneeId: worker.member.user.id
    });

    await expect(
      completeTask({
        taskId: first.task.id,
        actorId: owner.id
      })
    ).rejects.toMatchObject({
      status: 409,
      message: "Task has not been submitted for completion yet"
    });

    const request = await requestTaskCompletion({
      taskId: first.task.id,
      actorId: worker.member.user.id
    });
    expect(request.event?.type).toBe("TASK_COMPLETION_REQUESTED");
    expect(request.task.columnId).toBe(column.id);
    expect(request.task.completionRequestedBy?.id).toBe(worker.member.user.id);
    expect(request.announcement?.title).toContain(first.task.title);

    await requestTaskCompletion({
      taskId: second.task.id,
      actorId: worker.member.user.id
    });

    const ownerMembership = await prisma.projectMember.findUniqueOrThrow({
      where: {
        userId_projectId: {
          userId: owner.id,
          projectId: project.id
        }
      }
    });
    const ownerAnnouncements = await listAnnouncements(project.id, ownerMembership, 10);
    expect(ownerAnnouncements.announcements.some((announcement) => (
      announcement.body.includes(worker.member.user.name) && announcement.body.includes(first.task.title)
    ))).toBe(true);

    const firstCompleted = await completeTask({
      taskId: first.task.id,
      actorId: owner.id
    });
    const secondCompleted = await completeTask({
      taskId: second.task.id,
      actorId: owner.id
    });

    expect(firstCompleted.event?.type).toBe("TASK_COMPLETED");
    expect(firstCompleted.task.completedPosition).toBe(1);
    expect(firstCompleted.task.completedBy?.id).toBe(owner.id);
    expect(secondCompleted.task.completedPosition).toBe(2);

    const completedBoard = await getBoard(project.id);
    const completedColumn = completedBoard.columns.find((item) => item.id === column.id);
    expect(completedColumn?.tasks.map((task) => task.title)).not.toEqual(
      expect.arrayContaining([first.task.title, second.task.title])
    );
    expect(completedColumn?.completedTasks.map((task) => task.title)).toEqual([
      first.task.title,
      second.task.title
    ]);
    expect(completedColumn?.completedTasks[0]?.completedBy?.email).toBe(owner.email);

    const moved = await moveCompletedTask({
      taskId: second.task.id,
      actorId: owner.id,
      beforeTaskId: first.task.id
    });
    expect(moved.event?.type).toBe("TASK_ROADMAP_MOVED");

    const reorderedBoard = await getBoard(project.id);
    const reorderedColumn = reorderedBoard.columns.find((item) => item.id === column.id);
    expect(reorderedColumn?.completedTasks.map((task) => [task.title, task.completedPosition])).toEqual([
      [second.task.title, 1],
      [first.task.title, 2]
    ]);
  });

  it("shows members full board state and full history for projects where they participate", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const column = board.columns[0];

    const workerOne = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "member-one",
      role: "MEMBER"
    });
    const workerTwo = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "member-two",
      role: "MEMBER"
    });

    const group = await createTaskGroup({
      projectId: project.id,
      actorId: owner.id,
      name: "Solo group",
      memberIds: [workerOne.member.id]
    });

    const directTask = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "Visible direct task",
      priority: "HIGH",
      assigneeId: workerOne.member.user.id
    });
    const groupTask = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "Visible group task",
      priority: "MEDIUM",
      assigneeGroupId: group.group.id
    });
    const otherTask = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: column.id,
      title: "Hidden other task",
      priority: "LOW",
      assigneeId: workerTwo.member.user.id
    });

    const workerMembership = await prisma.projectMember.findUniqueOrThrow({
      where: { id: workerOne.member.id }
    });

    const memberBoard = await getBoard(project.id, workerMembership);
    const visibleTasks = memberBoard.columns.flatMap((boardColumn) => boardColumn.tasks);
    const visibleTitles = visibleTasks.map((task) => task.title);

    expect(visibleTitles).toEqual(
      expect.arrayContaining([directTask.task.title, groupTask.task.title, otherTask.task.title])
    );
    expect(visibleTasks).toHaveLength(3);
    expect(visibleTasks.map((task) => task.creator.email)).toEqual([owner.email, owner.email, owner.email]);

    const memberEvents = await listEvents(project.id, 50, workerMembership);
    const memberEventTitles = memberEvents.map((event) => taskTitleFromEventPayload(event.payload)).filter(Boolean);

    expect(memberEvents).toHaveLength(7);
    expect(memberEvents.every((event) => event.actor?.email === owner.email)).toBe(true);
    expect(memberEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["PROJECT_CREATED", "MEMBER_ADDED", "GROUP_CREATED", "TASK_CREATED"])
    );
    expect(memberEventTitles).toEqual(
      expect.arrayContaining([directTask.task.title, groupTask.task.title, "Hidden other task"])
    );
  });

  it("shows administrators full project history", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const sourceColumn = board.columns[0];
    const targetColumn = board.columns[1];

    const admin = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "admin",
      role: "ADMIN"
    });
    const member = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "member",
      role: "MEMBER"
    });

    const visibleTask = await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: sourceColumn.id,
      title: "Admin visible task",
      priority: "HIGH",
      assigneeId: admin.member.user.id
    });
    await createTask({
      projectId: project.id,
      actorId: owner.id,
      columnId: sourceColumn.id,
      title: "Admin hidden task",
      priority: "LOW",
      assigneeId: member.member.user.id
    });
    await moveTask({
      taskId: visibleTask.task.id,
      actorId: owner.id,
      columnId: targetColumn.id,
      clientVersion: visibleTask.task.version
    });
    await updateTask({
      taskId: visibleTask.task.id,
      actorId: owner.id,
      description: "Admin updated admin task"
    });

    const adminMembership = await prisma.projectMember.findUniqueOrThrow({
      where: { id: admin.member.id }
    });
    const adminEvents = await listEvents(project.id, 50, adminMembership);
    const adminEventTitles = adminEvents.map((event) => taskTitleFromEventPayload(event.payload)).filter(Boolean);

    expect(adminEvents).toHaveLength(7);
    expect(adminEvents.map((event) => event.type)).toEqual(
      expect.arrayContaining(["PROJECT_CREATED", "MEMBER_ADDED", "TASK_CREATED", "TASK_MOVED", "TASK_UPDATED"])
    );
    expect(adminEventTitles).toEqual(
      expect.arrayContaining(["Admin visible task", "Admin hidden task"])
    );
  });

  it("returns a conflict error when creating a duplicate group name", async () => {
    const { owner, project } = await createProjectFixture();

    const worker = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "duplicate-group",
      role: "MEMBER"
    });

    await createTaskGroup({
      projectId: project.id,
      actorId: owner.id,
      name: "Design team",
      memberIds: [worker.member.id]
    });

    await expect(
      createTaskGroup({
        projectId: project.id,
        actorId: owner.id,
        name: "Design team",
        memberIds: [worker.member.id]
      })
    ).rejects.toMatchObject({
      status: 409,
      message: "A group with this name already exists in the project"
    });
  });

  it("publishes project task events to all members of that project", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const column = board.columns[0];

    const workerOne = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "socket-one",
      role: "MEMBER"
    });
    const workerTwo = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "socket-two",
      role: "MEMBER"
    });

    const httpServer = createServer();
    const ioServer = createRealtimeServer(httpServer);
    const port = await listen(httpServer);
    const visibleClient = createSocketClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: signToken(workerOne.member.user)
      },
      transports: ["websocket"],
      forceNew: true
    });
    const hiddenClient = createSocketClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: signToken(workerTwo.member.user)
      },
      transports: ["websocket"],
      forceNew: true
    });

    try {
      await Promise.all(
        [visibleClient, hiddenClient].map(
          (client) =>
            new Promise<void>((resolve, reject) => {
              client.once("connect", resolve);
              client.once("connect_error", reject);
            })
        )
      );

      const [visibleJoin, hiddenJoin] = await Promise.all([
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          visibleClient.emit("project:join", { projectId: project.id }, resolve);
        }),
        new Promise<{ ok: boolean; error?: string }>((resolve) => {
          hiddenClient.emit("project:join", { projectId: project.id }, resolve);
        })
      ]);

      expect(visibleJoin).toEqual({ ok: true });
      expect(hiddenJoin).toEqual({ ok: true });

      const visibleEvent = waitForSocketEvent<{ type: string; taskId: string | null; actor: { email: string } }>(
        visibleClient,
        "sync:event"
      );
      const hiddenEvent = waitForSocketEvent<{ type: string; taskId: string | null; actor: { email: string } }>(
        hiddenClient,
        "sync:event"
      );
      const created = await createTask({
        projectId: project.id,
        actorId: owner.id,
        columnId: column.id,
        title: "Socket visible task",
        priority: "HIGH",
        assigneeId: workerOne.member.user.id
      });

      publishProjectEvent(ioServer, created.event);

      await expect(visibleEvent).resolves.toMatchObject({
        type: "TASK_CREATED",
        taskId: created.task.id,
        actor: {
          email: owner.email
        }
      });
      await expect(hiddenEvent).resolves.toMatchObject({
        type: "TASK_CREATED",
        taskId: created.task.id,
        actor: {
          email: owner.email
        }
      });
    } finally {
      visibleClient.disconnect();
      hiddenClient.disconnect();
      await closeRealtimeServer(ioServer);
    }
  });

  it("publishes realtime task events to administrators for any project task", async () => {
    const { owner, project } = await createProjectFixture();
    const board = await getBoard(project.id);
    const column = board.columns[0];

    const admin = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "socket-admin",
      role: "ADMIN"
    });
    const member = await addRegisteredMember({
      projectId: project.id,
      actorId: owner.id,
      label: "socket-member",
      role: "MEMBER"
    });

    const httpServer = createServer();
    const ioServer = createRealtimeServer(httpServer);
    const port = await listen(httpServer);
    const adminClient = createSocketClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: signToken(admin.member.user)
      },
      transports: ["websocket"],
      forceNew: true
    });

    try {
      await new Promise<void>((resolve, reject) => {
        adminClient.once("connect", resolve);
        adminClient.once("connect_error", reject);
      });

      const joinResponse = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        adminClient.emit("project:join", { projectId: project.id }, resolve);
      });

      expect(joinResponse).toEqual({ ok: true });

      const hiddenEvent = waitForSocketEvent<{ type: string; taskId: string | null; actor: { email: string } }>(
        adminClient,
        "sync:event"
      );
      const hiddenTask = await createTask({
        projectId: project.id,
        actorId: owner.id,
        columnId: column.id,
        title: "Admin hidden realtime task",
        priority: "LOW",
        assigneeId: member.member.user.id
      });
      publishProjectEvent(ioServer, hiddenTask.event);
      await expect(hiddenEvent).resolves.toMatchObject({
        type: "TASK_CREATED",
        taskId: hiddenTask.task.id,
        actor: {
          email: owner.email
        }
      });

      const visibleEvent = waitForSocketEvent<{ type: string; taskId: string | null; actor: { email: string } }>(
        adminClient,
        "sync:event"
      );
      const visibleTask = await createTask({
        projectId: project.id,
        actorId: owner.id,
        columnId: column.id,
        title: "Admin visible realtime task",
        priority: "HIGH",
        assigneeId: admin.member.user.id
      });
      publishProjectEvent(ioServer, visibleTask.event);

      await expect(visibleEvent).resolves.toMatchObject({
        type: "TASK_CREATED",
        taskId: visibleTask.task.id,
        actor: {
          email: owner.email
        }
      });
    } finally {
      adminClient.disconnect();
      await closeRealtimeServer(ioServer);
    }
  });

  it("delivers published events to authenticated Socket.IO project members", async () => {
    const { owner, project } = await createProjectFixture();
    const httpServer = createServer();
    const ioServer = createRealtimeServer(httpServer);
    const port = await listen(httpServer);
    const client = createSocketClient(`http://127.0.0.1:${port}`, {
      auth: {
        token: signToken(owner)
      },
      transports: ["websocket"],
      forceNew: true
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });

      const joinResponse = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        client.emit("project:join", { projectId: project.id }, resolve);
      });
      expect(joinResponse).toEqual({ ok: true });

      const receivedEvent = waitForSocketEvent<{ type: string; projectId: string }>(client, "sync:event");
      const event = await prisma.taskEvent.create({
        data: {
          projectId: project.id,
          actorId: owner.id,
          type: "PROJECT_CREATED",
          payload: {
            source: "socket integration test"
          }
        }
      });
      publishProjectEvent(ioServer, event);

      await expect(receivedEvent).resolves.toMatchObject({
        type: "PROJECT_CREATED",
        projectId: project.id
      });
    } finally {
      client.disconnect();
      await closeRealtimeServer(ioServer);
    }
  });
});
