import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { requireProjectMember, verifyToken, type AuthUser, type ProjectMembership } from "./auth.js";
import { announcementDto, eventDto } from "./serializers.js";
import { eventIsVisibleToViewer } from "./visibility.js";

type ServerToClientEvents = {
  "sync:event": (event: ReturnType<typeof eventDto> & { serverTime: number }) => void;
  "announcement:created": (announcement: ReturnType<typeof announcementDto> & { serverTime: number }) => void;
  "presence:update": (payload: { projectId: string; users: AuthUser[] }) => void;
  "connection:ready": (payload: { user: AuthUser }) => void;
};

type ClientToServerEvents = {
  "project:join": (payload: { projectId: string }, ack?: (response: { ok: boolean; error?: string }) => void) => void;
  "project:leave": (payload: { projectId: string }) => void;
  ping: (payload: { sentAt: number }, ack?: (response: { sentAt: number; serverTime: number }) => void) => void;
};

type InterServerEvents = Record<string, never>;

type SocketData = {
  user: AuthUser;
  projects: Map<string, ProjectMembership>;
};

export type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

const presence = new Map<string, Map<string, AuthUser>>();

function roomName(projectId: string) {
  return `project:${projectId}`;
}

function emitPresence(io: RealtimeServer, projectId: string) {
  const users = Array.from(presence.get(projectId)?.values() ?? []);
  io.to(roomName(projectId)).emit("presence:update", { projectId, users });
}

function addPresence(io: RealtimeServer, projectId: string, user: AuthUser) {
  const projectPresence = presence.get(projectId) ?? new Map<string, AuthUser>();
  projectPresence.set(user.id, user);
  presence.set(projectId, projectPresence);
  emitPresence(io, projectId);
}

function removePresence(io: RealtimeServer, projectId: string, userId: string) {
  const projectPresence = presence.get(projectId);
  if (!projectPresence) {
    return;
  }

  projectPresence.delete(userId);
  if (projectPresence.size === 0) {
    presence.delete(projectId);
  }
  emitPresence(io, projectId);
}

export function createRealtimeServer(httpServer: HttpServer) {
  const io: RealtimeServer = new Server(httpServer, {
    cors: {
      origin: config.clientOrigin,
      credentials: true
    }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") {
      return next(new Error("Token is required"));
    }

    try {
      socket.data.user = verifyToken(token);
      socket.data.projects = new Map();
      return next();
    } catch {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    socket.emit("connection:ready", { user: socket.data.user });

    socket.on("project:join", async ({ projectId }, ack) => {
      try {
        const membership = await requireProjectMember(projectId, socket.data.user.id);
        await socket.join(roomName(projectId));
        socket.data.projects.set(projectId, membership);
        addPresence(io, projectId, socket.data.user);
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : "Join failed" });
      }
    });

    socket.on("project:leave", ({ projectId }) => {
      socket.leave(roomName(projectId));
      socket.data.projects.delete(projectId);
      removePresence(io, projectId, socket.data.user.id);
    });

    socket.on("ping", (payload, ack) => {
      ack?.({ sentAt: payload.sentAt, serverTime: Date.now() });
    });

    socket.on("disconnect", () => {
      for (const projectId of socket.data.projects.keys()) {
        removePresence(io, projectId, socket.data.user.id);
      }
    });
  });

  return io;
}

export function publishProjectEvent(io: RealtimeServer, event: Parameters<typeof eventDto>[0]) {
  const payload = {
    ...eventDto(event),
    serverTime: Date.now()
  };

  for (const socket of io.sockets.sockets.values()) {
    const membership = socket.data.projects.get(event.projectId);
    if (!membership) {
      continue;
    }

    if (eventIsVisibleToViewer(payload, membership)) {
      socket.emit("sync:event", payload);
    }
  }
}

export function publishAnnouncement(io: RealtimeServer, announcement: ReturnType<typeof announcementDto>) {
  const payload = {
    ...announcement,
    serverTime: Date.now()
  };

  const recipientIds = new Set(announcement.recipients.map((recipient) => recipient.member.id));

  for (const socket of io.sockets.sockets.values()) {
    const membership = socket.data.projects.get(announcement.projectId);
    if (!membership || !recipientIds.has(membership.id)) {
      continue;
    }

    socket.emit("announcement:created", payload);
  }
}
