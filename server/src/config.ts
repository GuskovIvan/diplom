import "dotenv/config";

export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me"
};

if (!process.env.DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Copy .env.example to .env and configure PostgreSQL.");
}

if (config.jwtSecret === "dev-secret-change-me") {
  console.warn("JWT_SECRET uses a development default. Set a strong value in .env for production.");
}
