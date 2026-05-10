import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(120)
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const projectSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().default("")
});

export const manageableProjectRoleSchema = z.enum(["ADMIN", "MEMBER"]);

export const userCreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(120),
  projectIds: z.array(z.string().uuid()).optional().default([]),
  role: manageableProjectRoleSchema.optional().default("MEMBER")
});

export const userProjectsCreateSchema = z.object({
  projectIds: z.array(z.string().uuid()).min(1),
  role: manageableProjectRoleSchema.optional().default("MEMBER")
});

export const memberCreateSchema = z.object({
  userId: z.string().uuid(),
  role: manageableProjectRoleSchema.optional().default("MEMBER")
});

export const memberUpdateSchema = z.object({
  role: manageableProjectRoleSchema
});

export const taskGroupCreateSchema = z.object({
  name: z.string().min(2).max(80),
  memberIds: z.array(z.string().uuid()).min(1)
});

export const taskGroupUpdateSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  memberIds: z.array(z.string().uuid()).min(1).optional()
});

export const announcementCreateSchema = z.object({
  title: z.string().min(2).max(160),
  body: z.string().max(2000).optional().default(""),
  priority: z.enum(["NORMAL", "IMPORTANT", "URGENT"]).optional().default("NORMAL"),
  expiresAt: z.string().datetime().nullable().optional(),
  recipientMemberIds: z.array(z.string().uuid()).optional().default([]),
  recipientRoles: z.array(z.enum(["ADMIN", "MEMBER"])).optional().default([])
}).refine((value) => value.recipientMemberIds.length > 0 || value.recipientRoles.length > 0, {
  message: "Choose at least one announcement recipient",
  path: ["recipientMemberIds"]
});

export const columnCreateSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(500).optional().default("")
});

export const columnUpdateSchema = z.object({
  title: z.string().min(2).max(80).optional(),
  description: z.string().max(500).optional(),
  position: z.number().int().min(0).optional()
});

export const taskCreateSchema = z.object({
  columnId: z.string().uuid(),
  title: z.string().min(2).max(160),
  description: z.string().max(1500).optional().default(""),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().default("MEDIUM"),
  assigneeId: z.string().uuid().nullable().optional(),
  assigneeGroupId: z.string().uuid().nullable().optional()
}).refine((value) => !(value.assigneeId && value.assigneeGroupId), {
  message: "Task can be assigned either to a user or to a group",
  path: ["assigneeGroupId"]
});

export const taskUpdateSchema = z.object({
  title: z.string().min(2).max(160).optional(),
  description: z.string().max(1500).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  assigneeGroupId: z.string().uuid().nullable().optional(),
  clientVersion: z.number().int().min(1).optional()
}).refine((value) => !(value.assigneeId && value.assigneeGroupId), {
  message: "Task can be assigned either to a user or to a group",
  path: ["assigneeGroupId"]
});

export const taskMoveSchema = z.object({
  columnId: z.string().uuid(),
  beforeTaskId: z.string().uuid().nullable().optional(),
  afterTaskId: z.string().uuid().nullable().optional(),
  clientVersion: z.number().int().min(1).optional()
}).refine((value) => !(value.beforeTaskId && value.afterTaskId), {
  message: "Use either beforeTaskId or afterTaskId, not both",
  path: ["afterTaskId"]
});

export const completedTaskMoveSchema = z.object({
  beforeTaskId: z.string().uuid().nullable().optional(),
  afterTaskId: z.string().uuid().nullable().optional()
}).refine((value) => !(value.beforeTaskId && value.afterTaskId), {
  message: "Use either beforeTaskId or afterTaskId, not both",
  path: ["afterTaskId"]
});
