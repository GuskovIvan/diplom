import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { ProjectMember, ProjectRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { config } from "./config.js";
import { HttpError } from "./errors.js";
import { prisma } from "./prisma.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type AuthenticatedRequest = Request & {
  user: AuthUser;
};

export type ProjectMembership = Pick<ProjectMember, "id" | "projectId" | "role" | "userId">;

const tokenPayloadSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  name: z.string()
});

export function signToken(user: AuthUser) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name
    },
    config.jwtSecret,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token: string): AuthUser {
  const decoded = jwt.verify(token, config.jwtSecret);
  const payload = tokenPayloadSchema.parse(decoded);

  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name
  };
}

export function getBearerToken(req: Request) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = getBearerToken(req);
  if (!token) {
    return next(new HttpError(401, "Authorization token is required"));
  }

  try {
    (req as AuthenticatedRequest).user = verifyToken(token);
    return next();
  } catch {
    return next(new HttpError(401, "Invalid or expired token"));
  }
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function requireProjectMember(projectId: string, userId: string) {
  const member = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId,
        projectId
      }
    }
  });

  if (!member) {
    throw new HttpError(403, "You do not have access to this project");
  }

  return member;
}

export async function requireProjectCreationAccess(userId: string) {
  const member = await prisma.projectMember.findFirst({
    where: {
      userId,
      role: {
        in: ["ADMIN"]
      }
    }
  });

  if (!member) {
    throw new HttpError(403, "Only a project administrator can create a new project");
  }

  return member;
}

export async function requireAnyProjectAdmin(userId: string) {
  const member = await prisma.projectMember.findFirst({
    where: {
      userId,
      role: "ADMIN"
    }
  });

  if (!member) {
    throw new HttpError(403, "Only a project administrator can manage users");
  }

  return member;
}

export function isProjectAdminRole(role: ProjectRole) {
  return role === "ADMIN";
}

export function assertProjectAdmin(member: ProjectMembership) {
  if (!isProjectAdminRole(member.role)) {
    throw new HttpError(403, "Only a project administrator can do this");
  }
}

export async function requireProjectRole(projectId: string, userId: string, roles: readonly ProjectRole[]) {
  const member = await requireProjectMember(projectId, userId);
  if (!roles.includes(member.role)) {
    throw new HttpError(403, "Your project role does not allow this action");
  }

  return member;
}

export function requireProjectAdmin(projectId: string, userId: string) {
  return requireProjectRole(projectId, userId, ["ADMIN"]);
}
