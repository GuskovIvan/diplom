import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addProjectMember, createProject, createTask } from "./board.service.js";
import { errorHandler } from "./errors.js";
import { hashPassword, signToken } from "./auth.js";
import { prisma } from "./prisma.js";
import { createRealtimeServer, type RealtimeServer } from "./realtime.js";
import { registerRoutes } from "./routes.js";

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

function listen(server: http.Server) {
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

function closeServer(server: http.Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function closeRealtimeServer(ioServer: RealtimeServer) {
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

async function postProject(baseUrl: string, token: string, name: string) {
  const response = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name,
      description: "Project creation permissions test"
    })
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function postRegister(
  baseUrl: string,
  input: { email: string; name: string; password: string }
) {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function getAvailableUsers(baseUrl: string, token: string, projectId: string) {
  const response = await fetch(`${baseUrl}/api/projects/${projectId}/available-users`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function deleteProjectRequest(baseUrl: string, token: string, projectId: string) {
  return fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function postUser(
  baseUrl: string,
  token: string,
  input: { email: string; name: string; password: string; projectIds?: string[]; role?: "ADMIN" | "MEMBER" }
) {
  const response = await fetch(`${baseUrl}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function postUserProjects(
  baseUrl: string,
  token: string,
  userId: string,
  input: { projectIds: string[]; role?: "ADMIN" | "MEMBER" }
) {
  const response = await fetch(`${baseUrl}/api/users/${userId}/projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function deleteUserRequest(baseUrl: string, token: string, userId: string) {
  return fetch(`${baseUrl}/api/users/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

async function postMoveTask(baseUrl: string, token: string, taskId: string, input: { columnId: string }) {
  const response = await fetch(`${baseUrl}/api/tasks/${taskId}/move`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const body = await response.json().catch(() => ({}));
  return { response, body };
}

describe.sequential("project creation access", () => {
  let server: http.Server;
  let ioServer: RealtimeServer;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = createRealtimeServer(server);

    app.set("io", ioServer);
    app.use(express.json({ limit: "1mb" }));
    registerRoutes(app);
    app.use(errorHandler);

    const port = await listen(server);
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (ioServer) {
      await closeRealtimeServer(ioServer);
    }
    if (server?.listening) {
      await closeServer(server);
    }
    await prisma.project.deleteMany({
      where: {
        id: {
          in: createdProjectIds
        }
      }
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: createdUserIds
        }
      }
    });
  });

  it("registers a user without project membership or project role", async () => {
    const email = `registered-${randomUUID()}-${testRunId}@example.com`;
    const { response, body } = await postRegister(baseUrl, {
      email,
      name: "Registered User",
      password: "registered-password"
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      user: {
        email
      }
    });
    expect(body.user).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("project");
    expect(typeof body.token).toBe("string");
    expect(typeof body.user?.id).toBe("string");
    createdUserIds.push(body.user.id);

    await expect(prisma.projectMember.count({ where: { userId: body.user.id } })).resolves.toBe(0);

    const projectsResponse = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${body.token}`
      }
    });
    const projectsBody = await projectsResponse.json().catch(() => ({}));

    expect(projectsResponse.status).toBe(200);
    expect(projectsBody.projects).toEqual([]);
  });

  it("rejects project creation for a member-only user", async () => {
    const owner = await createTestUser("owner");
    const memberUser = await createTestUser("member");
    const initialProject = await createProject({
      ownerId: owner.id,
      name: `Initial project ${randomUUID()}`,
      description: "Access control fixture"
    });
    createdProjectIds.push(initialProject.project.id);

    await addProjectMember({
      projectId: initialProject.project.id,
      actorId: owner.id,
      userId: memberUser.id,
      role: "MEMBER"
    });

    const { response, body } = await postProject(baseUrl, signToken(memberUser), `Blocked project ${randomUUID()}`);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: "Only a project administrator can create a new project"
    });
  });

  it("allows project creation for an administrator", async () => {
    const owner = await createTestUser("owner-admin");
    const adminUser = await createTestUser("admin");
    const initialProject = await createProject({
      ownerId: owner.id,
      name: `Admin source project ${randomUUID()}`,
      description: "Access control fixture"
    });
    createdProjectIds.push(initialProject.project.id);

    await addProjectMember({
      projectId: initialProject.project.id,
      actorId: owner.id,
      userId: adminUser.id,
      role: "ADMIN"
    });

    const projectName = `Allowed project ${randomUUID()}`;
    const { response, body } = await postProject(baseUrl, signToken(adminUser), projectName);

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      project: {
        name: projectName
      }
    });
    expect(typeof body.project?.id).toBe("string");
    createdProjectIds.push(body.project.id);
  });

  it("lists registered users available for project membership", async () => {
    const owner = await createTestUser("owner-users");
    const candidate = await createTestUser("candidate");
    const initialProject = await createProject({
      ownerId: owner.id,
      name: `Available users project ${randomUUID()}`,
      description: "Available users fixture"
    });
    createdProjectIds.push(initialProject.project.id);

    const firstResponse = await getAvailableUsers(baseUrl, signToken(owner), initialProject.project.id);
    expect(firstResponse.response.status).toBe(200);
    expect(firstResponse.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidate.id,
          email: candidate.email
        })
      ])
    );
    expect(firstResponse.body.users).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: owner.id
        })
      ])
    );

    await addProjectMember({
      projectId: initialProject.project.id,
      actorId: owner.id,
      userId: candidate.id,
      role: "MEMBER"
    });

    const secondResponse = await getAvailableUsers(baseUrl, signToken(owner), initialProject.project.id);
    expect(secondResponse.body.users).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: candidate.id
        })
      ])
    );
  });

  it("creates a registered user and adds them to selected projects", async () => {
    const owner = await createTestUser("owner-create-user");
    const initialProject = await createProject({
      ownerId: owner.id,
      name: `User creation project ${randomUUID()}`,
      description: "User creation fixture"
    });
    const secondProject = await createProject({
      ownerId: owner.id,
      name: `Second user creation project ${randomUUID()}`,
      description: "Second user creation fixture"
    });
    createdProjectIds.push(initialProject.project.id, secondProject.project.id);

    const email = `created-user-${randomUUID()}-${testRunId}@example.com`;
    const { response, body } = await postUser(baseUrl, signToken(owner), {
      email,
      name: "Created User",
      password: "created-user-password",
      projectIds: [initialProject.project.id, secondProject.project.id],
      role: "MEMBER"
    });

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      user: {
        email
      },
      member: {
        role: "MEMBER"
      },
      members: expect.arrayContaining([
        expect.objectContaining({
          role: "MEMBER"
        })
      ])
    });
    expect(body.members).toHaveLength(2);
    expect(typeof body.user?.id).toBe("string");
    createdUserIds.push(body.user.id);

    await expect(
      prisma.projectMember.findUnique({
        where: {
          userId_projectId: {
            userId: body.user.id,
            projectId: initialProject.project.id
          }
        }
      })
    ).resolves.toMatchObject({
      role: "MEMBER"
    });
    await expect(
      prisma.projectMember.findUnique({
        where: {
          userId_projectId: {
            userId: body.user.id,
            projectId: secondProject.project.id
          }
        }
      })
    ).resolves.toMatchObject({
      role: "MEMBER"
    });
  });

  it("adds an existing registered user to selected projects", async () => {
    const owner = await createTestUser("owner-add-existing");
    const candidate = await createTestUser("existing-candidate");
    const firstProject = await createProject({
      ownerId: owner.id,
      name: `First existing-user project ${randomUUID()}`,
      description: "Existing user fixture"
    });
    const secondProject = await createProject({
      ownerId: owner.id,
      name: `Second existing-user project ${randomUUID()}`,
      description: "Existing user fixture"
    });
    createdProjectIds.push(firstProject.project.id, secondProject.project.id);

    const { response, body } = await postUserProjects(baseUrl, signToken(owner), candidate.id, {
      projectIds: [firstProject.project.id, secondProject.project.id],
      role: "MEMBER"
    });

    expect(response.status).toBe(201);
    expect(body.members).toHaveLength(2);
    await expect(
      prisma.projectMember.count({
        where: {
          userId: candidate.id,
          projectId: {
            in: [firstProject.project.id, secondProject.project.id]
          }
        }
      })
    ).resolves.toBe(2);
  });

  it("allows project members to move any task in their project", async () => {
    const owner = await createTestUser("owner-member-move");
    const memberUser = await createTestUser("member-move");
    const project = await createProject({
      ownerId: owner.id,
      name: `Member move project ${randomUUID()}`,
      description: "Member move fixture"
    });
    createdProjectIds.push(project.project.id);

    await addProjectMember({
      projectId: project.project.id,
      actorId: owner.id,
      userId: memberUser.id,
      role: "MEMBER"
    });

    const columns = await prisma.boardColumn.findMany({
      where: { projectId: project.project.id },
      orderBy: { position: "asc" }
    });
    const task = await createTask({
      projectId: project.project.id,
      actorId: owner.id,
      columnId: columns[0].id,
      title: "Task movable by any member",
      priority: "MEDIUM",
      assigneeId: owner.id
    });

    const { response, body } = await postMoveTask(baseUrl, signToken(memberUser), task.task.id, {
      columnId: columns[1].id
    });

    expect(response.status).toBe(200);
    expect(body.task).toMatchObject({
      id: task.task.id,
      columnId: columns[1].id
    });
  });

  it("allows project administrators to delete registered users", async () => {
    const owner = await createTestUser("owner-delete-user");
    const candidate = await createTestUser("delete-candidate");
    const initialProject = await createProject({
      ownerId: owner.id,
      name: `User deletion project ${randomUUID()}`,
      description: "User deletion fixture"
    });
    createdProjectIds.push(initialProject.project.id);
    const candidateProject = await createProject({
      ownerId: candidate.id,
      name: `Candidate owned project ${randomUUID()}`,
      description: "Owned project deletion fixture"
    });
    createdProjectIds.push(candidateProject.project.id);
    const candidateColumn = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: candidateProject.project.id },
      orderBy: { position: "asc" }
    });
    await createTask({
      projectId: candidateProject.project.id,
      actorId: candidate.id,
      columnId: candidateColumn.id,
      title: "Candidate-owned task",
      priority: "MEDIUM"
    });

    const response = await deleteUserRequest(baseUrl, signToken(owner), candidate.id);
    expect(response.status).toBe(204);
    await expect(prisma.user.findUnique({ where: { id: candidate.id } })).resolves.toBeNull();
    await expect(prisma.project.findUnique({ where: { id: candidateProject.project.id } })).resolves.toBeNull();
  });

  it("allows project administrators to delete a project", async () => {
    const owner = await createTestUser("owner-delete");
    const initialProject = await createProject({
      ownerId: owner.id,
      name: `Deleted project ${randomUUID()}`,
      description: "Deletion fixture"
    });
    createdProjectIds.push(initialProject.project.id);

    const response = await deleteProjectRequest(baseUrl, signToken(owner), initialProject.project.id);
    expect(response.status).toBe(204);
    await expect(prisma.project.findUnique({ where: { id: initialProject.project.id } })).resolves.toBeNull();
  });
});
