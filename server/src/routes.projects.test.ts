import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addProjectMember, createProject } from "./board.service.js";
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
      email: memberUser.email,
      role: "MEMBER"
    });

    const { response, body } = await postProject(baseUrl, signToken(memberUser), `Blocked project ${randomUUID()}`);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: "Only a project owner or administrator can create a new space"
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
      email: adminUser.email,
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
});
