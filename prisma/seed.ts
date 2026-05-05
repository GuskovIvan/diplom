import { Prisma, type ProjectRole, type User } from "@prisma/client";
import { hashPassword } from "../server/src/auth.js";
import { prisma } from "../server/src/prisma.js";

const demoUsers: Array<{
  email: string;
  name: string;
  password: string;
  role: ProjectRole;
}> = [
  {
    email: "demo@example.com",
    name: "Демо-владелец",
    password: "demo12345",
    role: "OWNER"
  },
  {
    email: "admin@example.com",
    name: "Администратор проекта",
    password: "admin12345",
    role: "ADMIN"
  },
  {
    email: "worker1@example.com",
    name: "Исполнитель 1",
    password: "worker12345",
    role: "MEMBER"
  },
  {
    email: "worker2@example.com",
    name: "Исполнитель 2",
    password: "worker12345",
    role: "MEMBER"
  }
];

async function ensureUser(input: (typeof demoUsers)[number]) {
  const existing = await prisma.user.findUnique({
    where: { email: input.email }
  });

  if (existing) {
    return existing;
  }

  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash: await hashPassword(input.password)
    }
  });
}

async function ensureProject(owner: User) {
  const existingProject = await prisma.project.findFirst({
    where: {
      ownerId: owner.id,
      name: "Дипломная доска задач"
    },
    include: {
      columns: true
    }
  });

  if (existingProject) {
    return existingProject;
  }

  return prisma.project.create({
    data: {
      name: "Дипломная доска задач",
      description: "Демонстрационная доска для проверки REST API, WebSocket, ролей участников и конфликтов версий.",
      ownerId: owner.id,
      columns: {
        create: [
          { title: "План", description: "Идеи и задачи, которые еще не взяли в работу.", position: 0 },
          { title: "В работе", description: "Задачи, которые сейчас выполняются.", position: 1 },
          { title: "На проверке", description: "Готовые изменения, ожидающие проверки.", position: 2 },
          { title: "Готово", description: "Завершенные задачи проекта.", position: 3 }
        ]
      }
    },
    include: {
      columns: true
    }
  });
}

async function ensureMembership(projectId: string, userId: string, role: ProjectRole) {
  await prisma.projectMember.upsert({
    where: {
      userId_projectId: {
        userId,
        projectId
      }
    },
    update: {
      role
    },
    create: {
      userId,
      projectId,
      role
    }
  });
}

async function ensureTasks(project: Awaited<ReturnType<typeof ensureProject>>, workers: User[]) {
  const existingTasks = await prisma.task.findMany({
    where: { projectId: project.id },
    orderBy: { createdAt: "asc" }
  });

  if (existingTasks.length > 0) {
    await Promise.all(
      existingTasks.slice(0, workers.length).map((task, index) =>
        prisma.task.update({
          where: { id: task.id },
          data: {
            creatorId: task.creatorId ?? project.ownerId,
            assigneeId: workers[index].id
          }
        })
      )
    );
    return;
  }

  const byTitle = new Map(project.columns.map((column) => [column.title, column]));

  await prisma.task.createMany({
    data: [
      {
        projectId: project.id,
        columnId: byTitle.get("План")!.id,
        title: "Описать объект и предмет исследования",
        description: "Связать предмет с REST, WebSocket и методами разрешения конфликтов.",
        priority: "HIGH",
        creatorId: project.ownerId,
        assigneeId: workers[0].id,
        position: new Prisma.Decimal(1000)
      },
      {
        projectId: project.id,
        columnId: byTitle.get("План")!.id,
        title: "Сравнить WebSocket, SSE и Long Polling",
        description: "Подготовить таблицу критериев: задержка, двунаправленность, нагрузка.",
        priority: "MEDIUM",
        creatorId: project.ownerId,
        assigneeId: workers[1].id,
        position: new Prisma.Decimal(2000)
      },
      {
        projectId: project.id,
        columnId: byTitle.get("В работе")!.id,
        title: "Реализовать ролевую модель доступа",
        description: "Владелец и администратор управляют участниками, исполнители работают со своими задачами.",
        priority: "HIGH",
        creatorId: project.ownerId,
        assigneeId: workers[0].id,
        position: new Prisma.Decimal(1000)
      },
      {
        projectId: project.id,
        columnId: byTitle.get("На проверке")!.id,
        title: "Проверить синхронизацию в двух вкладках",
        description: "Открыть проект под разными ролями и проверить обновление доски без перезагрузки.",
        priority: "MEDIUM",
        creatorId: project.ownerId,
        assigneeId: workers[1].id,
        position: new Prisma.Decimal(1000)
      }
    ]
  });

  await prisma.taskEvent.create({
    data: {
      projectId: project.id,
      actorId: project.ownerId,
      type: "PROJECT_CREATED",
      payload: {
        projectId: project.id,
        seed: true,
        message: "Начальные демо-данные"
      }
    }
  });
}

async function main() {
  const users = await Promise.all(demoUsers.map(ensureUser));
  const [owner, admin, worker1, worker2] = users;
  const project = await ensureProject(owner);

  await Promise.all(users.map((user, index) => ensureMembership(project.id, user.id, demoUsers[index].role)));
  await ensureTasks(project, [worker1, worker2]);

  console.log("Демо-данные готовы");
  console.log("Владелец:       demo@example.com / demo12345");
  console.log("Администратор: admin@example.com / admin12345");
  console.log("Исполнитель 1: worker1@example.com / worker12345");
  console.log("Исполнитель 2: worker2@example.com / worker12345");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
