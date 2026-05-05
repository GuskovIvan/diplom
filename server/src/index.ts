import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { errorHandler } from "./errors.js";
import { prisma } from "./prisma.js";
import { createRealtimeServer } from "./realtime.js";
import { registerRoutes } from "./routes.js";

const app = express();
const server = http.createServer(app);
const io = createRealtimeServer(server);

app.set("io", io);
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

registerRoutes(app);

const clientDist = path.resolve(process.cwd(), "dist/client");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use(errorHandler);

server.listen(config.port, () => {
  console.log(`REST API and Socket.IO server: http://localhost:${config.port}`);
});

const shutdown = async () => {
  console.log("Shutting down server...");
  await prisma.$disconnect();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
