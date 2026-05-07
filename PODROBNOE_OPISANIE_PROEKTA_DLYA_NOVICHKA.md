# Подробное описание проекта для новичка

> Важно: этот файл является подробным учебным конспектом. Для защиты и проверки актуальной версии проекта в первую очередь используйте `README.md`, `docs/architecture.md`, `docs/api.md` и `docs/testing-plan.md`. В них отражены последние доработки: события участников и групп, версионирование перемещений, перемещение внутри одной колонки и интеграционные тесты Socket.IO.

Этот файл объясняет проект максимально простым языком: что где находится, зачем это нужно, как части связаны между собой и что происходит внутри приложения.

Проект называется условно:

```text
diplom-realtime-kanban
```

Его тема:

```text
Разработка веб-приложения для командного управления проектами
с синхронизацией доски задач в реальном времени
на основе REST API и WebSocket
```

Если совсем коротко:

```text
Это Kanban-доска, похожая на Trello.
Пользователь может создавать задачи, редактировать их и перетаскивать между колонками.
Изменения сохраняются в PostgreSQL.
Другие открытые вкладки получают изменения через WebSocket без перезагрузки страницы.
```

## 1. Главная идея проекта

В проекте есть три основные части:

1. Клиентская часть, или frontend.
2. Серверная часть, или backend.
3. База данных PostgreSQL.

Frontend отвечает за то, что видит пользователь:

- экран входа;
- Kanban-доску;
- колонки;
- карточки задач;
- drag-and-drop;
- статус WebSocket-подключения;
- журнал событий.

Backend отвечает за логику:

- регистрация пользователя;
- вход пользователя;
- проверка JWT-токена;
- работа с проектами;
- работа с колонками;
- работа с карточками;
- запись изменений в PostgreSQL;
- отправка WebSocket-событий другим пользователям.

PostgreSQL хранит данные:

- пользователей;
- проекты;
- участников проектов;
- колонки доски;
- задачи;
- журнал событий.

## 2. Почему используются REST API и WebSocket одновременно

В дипломной теме важен гибридный подход.

REST API используется для операций, где нужна надежность:

- создать пользователя;
- войти в систему;
- создать проект;
- создать задачу;
- изменить задачу;
- удалить задачу;
- переместить задачу;
- получить состояние доски.

REST работает по схеме:

```text
Клиент отправил запрос -> сервер обработал -> сервер вернул ответ
```

Например:

```text
POST /api/tasks/:taskId/move
```

Это запрос на перемещение карточки.

WebSocket используется для мгновенных уведомлений.

Когда один пользователь изменил задачу, другим пользователям не нужно постоянно спрашивать сервер: “А что-то изменилось?” Сервер сам отправляет событие.

WebSocket работает по схеме:

```text
Клиент подключился к серверу -> соединение остается открытым -> сервер может сам отправлять события
```

Идея проекта:

```text
REST API отвечает за надежное изменение данных.
WebSocket отвечает за быструю синхронизацию интерфейса.
PostgreSQL отвечает за постоянное хранение данных.
```

## 3. Общая схема работы

Допустим, пользователь перетаскивает карточку из колонки `План` в колонку `В работе`.

Что происходит:

1. Пользователь берет карточку мышкой.
2. Frontend визуально перемещает карточку.
3. Frontend отправляет REST-запрос на backend.
4. Backend проверяет JWT-токен пользователя.
5. Backend проверяет, что пользователь состоит в проекте.
6. Backend рассчитывает новую позицию карточки.
7. Backend сохраняет новую колонку и позицию карточки в PostgreSQL.
8. Backend увеличивает версию карточки.
9. Backend записывает событие `TASK_MOVED` в таблицу `TaskEvent`.
10. Backend отправляет WebSocket-событие всем подключенным клиентам этой доски.
11. Другие вкладки получают событие.
12. Другие вкладки обновляют доску.

Это и есть синхронизация доски задач в реальном времени.

## 4. Корневая структура проекта

В корне проекта лежат основные файлы и папки:

```text
client/
server/
prisma/
docs/
dist/
node_modules/
package.json
package-lock.json
vite.config.ts
tsconfig.json
tsconfig.server.json
docker-compose.yml
.env
.env.example
.gitignore
README.md
KAK_ZAPUSTIT_I_POSMOTRET.md
PODROBNOE_OPISANIE_PROEKTA_DLYA_NOVICHKA.md
```

Теперь разберем каждую часть.

## 5. Файл package.json

Файл:

```text
package.json
```

Это один из главных файлов Node.js-проекта.

В нем указано:

- название проекта;
- версия проекта;
- команды запуска;
- зависимости;
- dev-зависимости.

### 5.1. Что такое зависимости

Зависимости - это готовые библиотеки, которые проект использует.

Например:

```json
"express": "^5.1.0"
```

Это значит, что проект использует Express для backend-сервера.

Другой пример:

```json
"react": "^19.2.0"
```

Это значит, что интерфейс сделан на React.

### 5.2. Основные команды

В `package.json` есть раздел `scripts`.

Главные команды:

```powershell
npm.cmd run dev
```

Запускает проект в режиме разработки. Обычно одновременно запускаются frontend и backend.

```powershell
npm.cmd run start
```

Запускает уже собранную версию backend-сервера из папки `dist`.

```powershell
npm.cmd run build
```

Собирает проект. Проверяет TypeScript и собирает frontend.

```powershell
npm.cmd test
```

Запускает тесты.

```powershell
npm.cmd run prisma:generate
```

Генерирует Prisma Client. Это нужно, чтобы TypeScript-код мог удобно обращаться к базе данных.

```powershell
npm.cmd run prisma:deploy
```

Применяет миграции к PostgreSQL.

```powershell
npm.cmd run db:seed
```

Создает демо-данные в базе.

## 6. Файл package-lock.json

Файл:

```text
package-lock.json
```

Он создается автоматически после `npm install`.

Для новичка важно понять:

```text
package.json говорит, какие библиотеки нужны проекту.
package-lock.json фиксирует точные версии этих библиотек.
```

Этот файл нужен, чтобы на другом компьютере проект установился с такими же версиями пакетов.

Обычно вручную его не редактируют.

## 7. Папка node_modules

Папка:

```text
node_modules/
```

Здесь физически лежат установленные библиотеки.

Она появляется после команды:

```powershell
npm.cmd install
```

Эту папку обычно не изучают и не редактируют руками.

Она может быть очень большой.

В Git ее обычно не добавляют. Поэтому в `.gitignore` указано:

```text
node_modules/
```

## 8. Файл .env

Файл:

```text
.env
```

Это файл с настройками окружения.

В нем лежат данные, которые могут отличаться на разных компьютерах:

```text
DATABASE_URL="postgresql://kanban:kanban_password@localhost:5432/kanban_diplom?schema=public"
JWT_SECRET="local-diploma-development-secret"
PORT=4000
CLIENT_ORIGIN="http://localhost:5173"
```

### 8.1. DATABASE_URL

```text
DATABASE_URL
```

Это строка подключения к PostgreSQL.

Она говорит приложению:

- какая база используется;
- какой пользователь;
- какой пароль;
- какой адрес сервера;
- какой порт;
- какая база данных.

Разбор строки:

```text
postgresql://kanban:kanban_password@localhost:5432/kanban_diplom?schema=public
```

Здесь:

```text
postgresql
```

Тип базы данных.

```text
kanban
```

Имя пользователя БД.

```text
kanban_password
```

Пароль пользователя БД.

```text
localhost
```

База запущена на этом же компьютере.

```text
5432
```

Стандартный порт PostgreSQL.

```text
kanban_diplom
```

Название базы данных.

### 8.2. JWT_SECRET

```text
JWT_SECRET
```

Это секретная строка для подписи JWT-токенов.

JWT нужен для авторизации.

Когда пользователь входит в систему, backend выдает ему токен. Потом frontend отправляет этот токен в каждом защищенном запросе.

Упрощенно:

```text
JWT-токен = пропуск пользователя
```

### 8.3. PORT

```text
PORT=4000
```

Это порт backend-сервера.

Приложение открывается по адресу:

```text
http://localhost:4000
```

### 8.4. CLIENT_ORIGIN

```text
CLIENT_ORIGIN="http://localhost:5173"
```

Это адрес frontend-приложения в режиме разработки.

Backend использует его для CORS.

CORS - это механизм безопасности браузера, который определяет, с каких адресов можно обращаться к серверу.

## 9. Файл .env.example

Файл:

```text
.env.example
```

Это пример файла `.env`.

Его удобно хранить в проекте, чтобы другой человек понял, какие переменные окружения нужны.

Обычно делают так:

```powershell
copy .env.example .env
```

Потом в `.env` меняют значения под свой компьютер.

## 10. Файл .gitignore

Файл:

```text
.gitignore
```

Он говорит Git, какие файлы не нужно сохранять в репозитории.

Например:

```text
node_modules/
dist/
.env
*.log
```

Почему:

- `node_modules/` слишком большая и восстанавливается через `npm install`;
- `dist/` создается автоматически после сборки;
- `.env` может содержать пароли;
- `*.log` - временные лог-файлы.

## 11. Файл docker-compose.yml

Файл:

```text
docker-compose.yml
```

Он нужен, чтобы можно было поднять инфраструктуру через Docker.

В проекте там описаны:

- PostgreSQL;
- Redis.

PostgreSQL нужен прямо сейчас.

Redis добавлен как заготовка для масштабирования WebSocket-серверов.

### 11.1. Зачем Redis

Если backend один, WebSocket-события можно хранить и рассылать в памяти одного процесса.

Но если backend-серверов несколько, например:

```text
Backend 1
Backend 2
Backend 3
```

Тогда пользователь A может быть подключен к `Backend 1`, а пользователь B - к `Backend 2`.

Чтобы событие дошло всем, используют Redis Pub/Sub.

В дипломе это можно описать как рекомендацию по масштабированию.

## 12. Файл vite.config.ts

Файл:

```text
vite.config.ts
```

Это настройка Vite.

Vite используется для frontend-разработки.

В файле есть:

```ts
server: {
  port: 5173,
  proxy: {
    "/api": "http://localhost:4000",
    "/socket.io": {
      target: "http://localhost:4000",
      ws: true
    }
  }
}
```

Что это значит:

- frontend в режиме разработки запускается на `http://localhost:5173`;
- backend работает на `http://localhost:4000`;
- все запросы `/api` Vite перенаправляет на backend;
- WebSocket-запросы `/socket.io` тоже перенаправляются на backend.

Зачем это нужно:

```text
Чтобы frontend мог обращаться к backend так, будто они находятся на одном адресе.
```

## 13. Файл tsconfig.json

Файл:

```text
tsconfig.json
```

Это настройки TypeScript для frontend-части.

TypeScript - это JavaScript с типами.

Типы помогают находить ошибки раньше, до запуска приложения.

Например, если функция ждет строку, а вы передали число, TypeScript может подсказать ошибку.

## 14. Файл tsconfig.server.json

Файл:

```text
tsconfig.server.json
```

Это настройки TypeScript для backend-части.

Почему отдельно:

- frontend работает в браузере;
- backend работает в Node.js;
- у них разные окружения и разные настройки сборки.

## 15. Файл index.html

Файл:

```text
index.html
```

Это главный HTML-файл frontend-приложения.

В нем есть:

```html
<div id="root"></div>
```

React вставляет всё приложение внутрь этого блока.

Также там подключается главный frontend-файл:

```html
<script type="module" src="/client/src/main.tsx"></script>
```

## 16. Папка prisma

Папка:

```text
prisma/
```

Она отвечает за работу с базой данных.

Внутри:

```text
prisma/schema.prisma
prisma/seed.ts
prisma/migrations/
```

## 17. Файл prisma/schema.prisma

Файл:

```text
prisma/schema.prisma
```

Это один из самых важных файлов проекта.

В нем описана модель базы данных.

Prisma по этому файлу понимает:

- какие таблицы есть;
- какие поля есть в таблицах;
- какие связи между таблицами;
- какие enum-типы используются.

## 18. Generator и datasource в schema.prisma

В начале файла есть:

```prisma
generator client {
  provider = "prisma-client-js"
}
```

Это говорит Prisma:

```text
Сгенерируй JavaScript/TypeScript-клиент для работы с базой.
```

Дальше:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Это говорит:

```text
Используется PostgreSQL.
Строку подключения брать из .env, из переменной DATABASE_URL.
```

## 19. Enum-типы в базе

В `schema.prisma` есть enum:

```prisma
enum ProjectRole {
  ADMIN
  MEMBER
}
```

Это роли участников проекта:

- `ADMIN` - администратор, может управлять колонками, задачами, администраторами и участниками;
- `MEMBER` - обычный участник или исполнитель, видит проект и работает только с назначенными ему задачами.

Еще есть:

```prisma
enum TaskPriority {
  LOW
  MEDIUM
  HIGH
}
```

Это приоритет задачи:

- низкий;
- средний;
- высокий.

Еще есть:

```prisma
enum TaskEventType {
  PROJECT_CREATED
  COLUMN_CREATED
  COLUMN_UPDATED
  COLUMN_DELETED
  TASK_CREATED
  TASK_UPDATED
  TASK_MOVED
  TASK_DELETED
}
```

Это типы событий, которые записываются в журнал.

## 20. Таблица User

Модель:

```prisma
model User
```

Это пользователи приложения.

Основные поля:

```text
id
email
name
passwordHash
createdAt
updatedAt
```

`id` - уникальный идентификатор пользователя.

`email` - почта пользователя. Она уникальная.

`name` - имя пользователя.

`passwordHash` - не сам пароль, а его хеш.

Важно:

```text
Пароли нельзя хранить в открытом виде.
```

Поэтому используется bcrypt. Он превращает пароль в хеш.

## 21. Таблица Project

Модель:

```prisma
model Project
```

Это проект, внутри которого находится Kanban-доска.

Основные поля:

```text
id
name
description
ownerId
version
createdAt
updatedAt
```

`ownerId` хранит пользователя, который создал проект.

`version` нужна для общей версии проекта.

Связи:

- проект имеет создателя;
- проект имеет участников;
- проект имеет колонки;
- проект имеет задачи;
- проект имеет события.

## 22. Таблица ProjectMember

Модель:

```prisma
model ProjectMember
```

Она связывает пользователей и проекты.

Зачем отдельная таблица:

```text
Один пользователь может участвовать в нескольких проектах.
Один проект может иметь нескольких пользователей.
```

Это связь многие-ко-многим.

Поля:

```text
userId
projectId
role
```

## 23. Таблица BoardColumn

Модель:

```prisma
model BoardColumn
```

Это колонка Kanban-доски.

Примеры колонок:

```text
План
В работе
На проверке
Готово
```

Поля:

```text
id
projectId
title
position
version
createdAt
updatedAt
```

`position` нужна, чтобы сортировать колонки.

`version` нужна для версионирования.

## 24. Таблица Task

Модель:

```prisma
model Task
```

Это карточка задачи.

Поля:

```text
id
projectId
columnId
title
description
priority
position
version
assigneeId
createdAt
updatedAt
```

`projectId` говорит, к какому проекту относится задача.

`columnId` говорит, в какой колонке находится задача.

`title` - название задачи.

`description` - описание.

`priority` - приоритет.

`position` - позиция внутри колонки.

`version` - версия карточки.

`assigneeId` - исполнитель задачи, если назначен.

## 25. Почему position у Task имеет тип Decimal

В `Task` поле `position` описано так:

```prisma
position Decimal @db.Decimal(20, 8)
```

Это сделано для удобного перемещения карточек.

Пример:

```text
Задача A: position = 1000
Задача B: position = 2000
```

Если нужно вставить новую задачу между ними, можно поставить:

```text
position = 1500
```

Не нужно пересчитывать все карточки в колонке.

Это снижает количество изменений в базе.

## 26. Таблица TaskEvent

Модель:

```prisma
model TaskEvent
```

Это журнал событий.

Каждое важное действие записывается сюда.

Например:

- карточка создана;
- карточка изменена;
- карточка перемещена;
- карточка удалена;
- колонка создана;
- колонка удалена.

Поля:

```text
id
projectId
taskId
actorId
type
payload
createdAt
```

`actorId` - кто сделал действие.

`type` - тип события.

`payload` - дополнительные данные события в JSON.

Зачем это нужно:

- можно показывать журнал событий в интерфейсе;
- можно анализировать историю изменений;
- можно использовать события для синхронизации;
- удобно демонстрировать работу WebSocket на защите.

## 27. Папка prisma/migrations

Папка:

```text
prisma/migrations/
```

В ней лежат SQL-миграции.

Миграция - это инструкция, как создать или изменить структуру базы данных.

В проекте есть файл:

```text
prisma/migrations/20260417120000_init/migration.sql
```

Он создает:

- enum-типы;
- таблицу `User`;
- таблицу `Project`;
- таблицу `ProjectMember`;
- таблицу `BoardColumn`;
- таблицу `Task`;
- таблицу `TaskEvent`;
- индексы;
- внешние ключи.

Команда для применения миграций:

```powershell
npm.cmd run prisma:deploy
```

## 28. Файл prisma/seed.ts

Файл:

```text
prisma/seed.ts
```

Seed-файл нужен, чтобы заполнить базу начальными данными.

Он создает:

- демо-администратора;
- администратора проекта;
- двух исполнителей;
- демо-проект;
- 4 колонки;
- несколько задач;
- первое событие в журнале.

Команда:

```powershell
npm.cmd run db:seed
```

Демо-пользователи:

```text
Демо-админ:      demo@example.com / demo12345
Администратор: admin@example.com / admin12345
Исполнитель 1: worker1@example.com / worker12345
Исполнитель 2: worker2@example.com / worker12345
```

## 29. Папка server

Папка:

```text
server/
```

Это backend-часть проекта.

Внутри:

```text
server/src/index.ts
server/src/config.ts
server/src/prisma.ts
server/src/auth.ts
server/src/routes.ts
server/src/board.service.ts
server/src/realtime.ts
server/src/schemas.ts
server/src/serializers.ts
server/src/errors.ts
server/src/positioning.ts
server/src/positioning.test.ts
```

Теперь разберем каждый файл.

## 30. server/src/index.ts

Файл:

```text
server/src/index.ts
```

Это точка входа backend-сервера.

Простыми словами:

```text
С этого файла начинается запуск backend.
```

Что он делает:

1. Создает Express-приложение.
2. Создает HTTP-сервер.
3. Подключает Socket.IO.
4. Настраивает CORS.
5. Включает обработку JSON.
6. Регистрирует REST-маршруты.
7. Отдает собранный frontend из `dist/client`.
8. Подключает обработчик ошибок.
9. Запускает сервер на порту `4000`.
10. Корректно отключает Prisma при остановке.

Главная строка для запуска:

```ts
server.listen(config.port, () => {
  console.log(`REST API and Socket.IO server: http://localhost:${config.port}`);
});
```

Именно поэтому приложение доступно по адресу:

```text
http://localhost:4000
```

## 31. server/src/config.ts

Файл:

```text
server/src/config.ts
```

Он читает настройки из `.env`.

Например:

```ts
port: Number(process.env.PORT ?? 4000)
```

Если в `.env` есть `PORT`, берется он.

Если его нет, используется `4000`.

Также тут читаются:

- `CLIENT_ORIGIN`;
- `JWT_SECRET`.

Файл также выводит предупреждения, если важные настройки не указаны.

## 32. server/src/prisma.ts

Файл:

```text
server/src/prisma.ts
```

Он создает один общий объект Prisma Client:

```ts
export const prisma = new PrismaClient();
```

Через этот объект backend работает с PostgreSQL.

Например:

```ts
prisma.user.findUnique(...)
prisma.task.create(...)
prisma.project.findMany(...)
```

Зачем отдельный файл:

```text
Чтобы во всех частях backend использовать один общий клиент базы данных.
```

## 33. server/src/auth.ts

Файл:

```text
server/src/auth.ts
```

Он отвечает за авторизацию.

В нем есть логика:

- создание JWT-токена;
- проверка JWT-токена;
- получение Bearer token из заголовка;
- middleware `requireAuth`;
- хеширование пароля;
- сравнение пароля;
- проверка, что пользователь является участником проекта.

### 33.1. Что такое JWT

JWT - это токен авторизации.

После входа пользователь получает токен.

Frontend хранит его в `localStorage`.

Потом frontend отправляет его в запросах:

```http
Authorization: Bearer <token>
```

Backend проверяет токен и понимает, кто делает запрос.

### 33.2. requireAuth

Функция:

```ts
requireAuth
```

Это middleware Express.

Middleware - это промежуточная функция, которая выполняется перед основным обработчиком запроса.

`requireAuth` проверяет:

- есть ли заголовок `Authorization`;
- начинается ли он с `Bearer`;
- валиден ли JWT;
- можно ли извлечь пользователя из токена.

Если все хорошо, пользователь добавляется в `req.user`.

Если нет, сервер возвращает ошибку `401`.

### 33.3. requireProjectMember

Функция:

```ts
requireProjectMember(projectId, userId)
```

Она проверяет, что пользователь состоит в проекте.

Зачем:

```text
Пользователь не должен видеть и менять чужие проекты.
```

Если пользователь не участник проекта, сервер возвращает `403`.

## 34. server/src/schemas.ts

Файл:

```text
server/src/schemas.ts
```

Он содержит схемы валидации Zod.

Zod проверяет входящие данные.

Например:

```ts
registerSchema
```

Проверяет регистрацию:

- email должен быть email;
- имя должно быть минимум 2 символа;
- пароль должен быть минимум 8 символов.

Пример:

```ts
export const taskCreateSchema = z.object({
  columnId: z.string().uuid(),
  title: z.string().min(2).max(160),
  description: z.string().max(1500).optional().default(""),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional().default("MEDIUM")
});
```

Это значит:

- `columnId` должен быть UUID;
- `title` обязателен;
- `description` необязателен;
- `priority` может быть только `LOW`, `MEDIUM` или `HIGH`.

Зачем валидация:

```text
Чтобы сервер не принимал неправильные или опасные данные.
```

## 35. server/src/routes.ts

Файл:

```text
server/src/routes.ts
```

Это REST API проекта.

Здесь описаны адреса, на которые frontend отправляет HTTP-запросы.

Примеры:

```text
POST /api/auth/register
POST /api/auth/login
GET /api/projects
POST /api/projects
GET /api/projects/:projectId/board
POST /api/projects/:projectId/tasks
PATCH /api/tasks/:taskId
POST /api/tasks/:taskId/move
DELETE /api/tasks/:taskId
```

### 35.1. /api/health

Маршрут:

```text
GET /api/health
```

Он проверяет, что сервер работает и может подключиться к PostgreSQL.

Ответ:

```json
{
  "ok": true,
  "database": "postgresql"
}
```

### 35.2. /api/auth/register

Маршрут:

```text
POST /api/auth/register
```

Создает нового пользователя.

Что происходит:

1. Сервер проверяет входные данные.
2. Проверяет, нет ли уже пользователя с таким email.
3. Хеширует пароль.
4. Создает пользователя в БД.
5. Создает для него демо-проект.
6. Возвращает JWT-токен.

### 35.3. /api/auth/login

Маршрут:

```text
POST /api/auth/login
```

Выполняет вход.

Что происходит:

1. Сервер ищет пользователя по email.
2. Сравнивает введенный пароль с хешем в БД.
3. Если пароль верный, возвращает JWT.
4. Если пароль неверный, возвращает `401`.

### 35.4. Защищенные маршруты

После входа в `routes.ts` вызывается:

```ts
router.use(requireAuth);
```

Это значит:

```text
Все маршруты ниже требуют авторизации.
```

Без JWT-токена они не работают.

### 35.5. Маршруты проектов

```text
GET /api/projects
```

Возвращает проекты пользователя.

```text
POST /api/projects
```

Создает новый проект.

```text
GET /api/projects/:projectId/board
```

Возвращает полное состояние доски:

- проект;
- участников;
- колонки;
- карточки.

### 35.6. Маршруты колонок

```text
POST /api/projects/:projectId/columns
```

Создает колонку.

```text
PATCH /api/columns/:columnId
```

Изменяет колонку.

```text
DELETE /api/columns/:columnId
```

Удаляет колонку.

### 35.7. Маршруты задач

```text
POST /api/projects/:projectId/tasks
```

Создает задачу.

```text
PATCH /api/tasks/:taskId
```

Изменяет задачу.

```text
POST /api/tasks/:taskId/move
```

Перемещает задачу.

```text
DELETE /api/tasks/:taskId
```

Удаляет задачу.

### 35.8. Связь REST и WebSocket

Важный момент:

После изменения данных REST-маршрут вызывает:

```ts
publish(req, result.event);
```

Это отправляет WebSocket-событие другим клиентам.

То есть:

```text
REST изменил данные -> backend записал событие -> WebSocket разослал событие
```

## 36. server/src/board.service.ts

Файл:

```text
server/src/board.service.ts
```

Это бизнес-логика Kanban-доски.

Если `routes.ts` отвечает на вопрос:

```text
По какому адресу приходит запрос?
```

то `board.service.ts` отвечает на вопрос:

```text
Что именно нужно сделать с данными?
```

Здесь находятся функции:

- `listProjects`;
- `createProject`;
- `getBoard`;
- `createColumn`;
- `updateColumn`;
- `deleteColumn`;
- `createTask`;
- `updateTask`;
- `deleteTask`;
- `moveTask`;
- `listEvents`;
- `getRealtimeMetrics`.

### 36.1. Транзакции

Важные операции выполняются через:

```ts
prisma.$transaction(...)
```

Транзакция означает:

```text
Либо выполняются все действия, либо не выполняется ничего.
```

Пример:

Когда создается задача, нужно:

1. Создать запись в `Task`.
2. Создать запись в `TaskEvent`.
3. Увеличить версию проекта.

Если один шаг сломался, остальные не должны остаться наполовину выполненными.

### 36.2. createTask

Функция:

```ts
createTask(...)
```

Создает новую карточку.

Что делает:

1. Проверяет, что колонка существует в проекте.
2. Находит последнюю задачу в колонке.
3. Назначает новой задаче позицию.
4. Создает задачу в PostgreSQL.
5. Создает событие `TASK_CREATED`.
6. Увеличивает версию проекта.
7. Возвращает задачу и событие.

### 36.3. moveTask

Функция:

```ts
moveTask(...)
```

Это одна из ключевых функций диплома.

Она отвечает за перемещение карточки.

Что делает:

1. Находит текущую карточку.
2. Проверяет, что новая колонка существует в том же проекте.
3. Загружает задачи целевой колонки.
4. Рассчитывает новую позицию карточки.
5. Проверяет конфликт версий.
6. Обновляет карточку в PostgreSQL.
7. Создает событие `TASK_MOVED`.
8. Увеличивает версию проекта.
9. Возвращает результат.

### 36.4. Разрешение конфликтов

В проекте используется стратегия:

```text
LAST_WRITE_WINS
```

По-русски:

```text
Побеждает последнее действие.
```

Каждая задача имеет поле:

```text
version
```

Когда клиент отправляет изменение, он передает:

```text
clientVersion
```

Если `clientVersion` меньше текущей версии на сервере, значит пользователь работал с устаревшими данными.

Сервер всё равно принимает последнее действие, но записывает в событие:

```text
conflict.resolved = true
strategy = LAST_WRITE_WINS
```

Для Kanban-доски это разумный подход, потому что карточка является отдельной сущностью.

## 37. server/src/positioning.ts

Файл:

```text
server/src/positioning.ts
```

Он отвечает за расчет позиции карточки внутри колонки.

Основная функция:

```ts
calculateMovePosition(...)
```

Она получает:

- список задач в колонке;
- id перемещаемой задачи;
- задачу, перед которой нужно вставить;
- задачу, после которой нужно вставить.

И возвращает новую позицию.

Пример:

```text
A = 1000
B = 2000
```

Если вставляем между A и B:

```text
position = 1500
```

Зачем так:

```text
Чтобы не пересчитывать позиции всех карточек при каждом перемещении.
```

## 38. server/src/positioning.test.ts

Файл:

```text
server/src/positioning.test.ts
```

Это тесты для расчета позиции карточек.

Запуск:

```powershell
npm.cmd test
```

Тесты проверяют:

- позицию в пустой колонке;
- добавление в конец;
- вставку перед другой карточкой;
- игнорирование самой перемещаемой карточки при расчете.

Зачем тесты:

```text
Чтобы показать, что важная алгоритмическая часть проекта проверяется автоматически.
```

## 39. server/src/realtime.ts

Файл:

```text
server/src/realtime.ts
```

Это WebSocket-часть проекта.

Используется библиотека:

```text
Socket.IO
```

Socket.IO построен поверх WebSocket и добавляет удобные возможности:

- автоматическое переподключение;
- комнаты;
- fallback-транспорты;
- события с именами;
- acknowledgements.

### 39.1. Подключение клиента

Когда клиент подключается, он передает JWT:

```ts
io("/", {
  auth: { token }
});
```

Сервер проверяет токен:

```ts
socket.data.user = verifyToken(token);
```

Если токен плохой, подключение отклоняется.

### 39.2. Комнаты проектов

В Socket.IO есть комнаты.

Для каждого проекта создается комната:

```text
project:<projectId>
```

Например:

```text
project:abc-123
```

Когда пользователь открывает доску, frontend отправляет:

```ts
socket.emit("project:join", { projectId });
```

Сервер проверяет:

- пользователь авторизован;
- пользователь является участником проекта.

Потом добавляет сокет в комнату.

### 39.3. Отправка события

Когда REST API изменил задачу, вызывается:

```ts
publishProjectEvent(io, event)
```

Сервер отправляет событие всем клиентам комнаты:

```ts
io.to(roomName(event.projectId)).emit("sync:event", ...)
```

Это означает:

```text
Все пользователи, открывшие эту доску, получат событие.
```

### 39.4. Presence

Presence - это информация о том, кто сейчас онлайн.

В проекте есть событие:

```text
presence:update
```

Оно отправляет список пользователей, подключенных к проекту.

На frontend это отображается как количество участников.

### 39.5. Измерение задержки

Клиент периодически отправляет:

```text
ping
```

Сервер отвечает, и клиент считает задержку.

Также при `sync:event` сервер отправляет:

```text
serverTime
```

Клиент может сравнить `Date.now()` и `serverTime`.

Это полезно для дипломной цели:

```text
измерить задержку синхронизации
```

## 40. server/src/serializers.ts

Файл:

```text
server/src/serializers.ts
```

Он преобразует данные из базы в формат для ответа API.

Зачем это нужно:

```text
Структура объекта в базе не всегда должна полностью совпадать с тем,
что мы отправляем клиенту.
```

Например, в таблице `User` есть:

```text
passwordHash
```

Но клиенту нельзя отправлять хеш пароля.

Поэтому `userDto` возвращает только:

```text
id
email
name
```

DTO означает:

```text
Data Transfer Object
```

То есть объект для передачи данных.

## 41. server/src/errors.ts

Файл:

```text
server/src/errors.ts
```

Он отвечает за обработку ошибок.

Есть класс:

```ts
HttpError
```

Он позволяет удобно выбрасывать ошибки с HTTP-статусом.

Например:

```ts
throw new HttpError(404, "Task was not found");
```

Это значит:

```text
Задача не найдена, вернуть HTTP 404.
```

Есть функция:

```ts
asyncRoute
```

Она нужна, чтобы ошибки в async-функциях Express корректно попадали в обработчик ошибок.

Есть функция:

```ts
errorHandler
```

Она отправляет клиенту аккуратный JSON-ответ с ошибкой.

## 42. Папка client

Папка:

```text
client/
```

Это frontend-часть проекта.

Внутри:

```text
client/src/main.tsx
client/src/api.ts
client/src/types.ts
client/src/styles.css
```

## 43. client/src/types.ts

Файл:

```text
client/src/types.ts
```

Здесь описаны TypeScript-типы frontend-части.

Например:

```ts
export type User = {
  id: string;
  email: string;
  name: string;
};
```

Это значит:

```text
Пользователь всегда имеет id, email и name.
```

Другие типы:

- `Project`;
- `Task`;
- `BoardColumn`;
- `Board`;
- `SyncEvent`;
- `AuthState`.

Зачем нужны типы:

```text
Чтобы frontend понимал структуру данных и заранее ловил ошибки.
```

## 44. client/src/api.ts

Файл:

```text
client/src/api.ts
```

Он отвечает за HTTP-запросы к backend.

В нем есть функции:

- `register`;
- `login`;
- `projects`;
- `createProject`;
- `board`;
- `events`;
- `createColumn`;
- `createTask`;
- `updateTask`;
- `moveTask`;
- `deleteTask`.

Например:

```ts
api.login({ email, password })
```

Отправляет:

```text
POST /api/auth/login
```

### 44.1. Работа с токеном

В файле есть функции:

```ts
loadAuth()
saveAuth()
clearAuth()
```

Они работают с `localStorage`.

`localStorage` - это хранилище в браузере.

Туда сохраняется:

- JWT-токен;
- данные пользователя.

Благодаря этому после обновления страницы пользователь остается авторизованным.

## 45. client/src/main.tsx

Файл:

```text
client/src/main.tsx
```

Это главный файл frontend-приложения.

В нем находится большая часть интерфейса.

### 45.1. App

Компонент:

```tsx
function App()
```

Он решает, что показать:

- если пользователь не вошел, показать экран входа;
- если пользователь вошел, показать доску.

Упрощенно:

```text
Если auth нет -> AuthScreen
Если auth есть -> BoardScreen
```

### 45.2. AuthScreen

Компонент:

```tsx
AuthScreen
```

Это экран входа и регистрации.

Он содержит:

- переключатель “Вход / Регистрация”;
- поле email;
- поле пароль;
- поле имя при регистрации;
- кнопку входа или регистрации.

Когда пользователь нажимает кнопку:

- вызывается `api.login` или `api.register`;
- полученный токен сохраняется;
- приложение переключается на доску.

### 45.3. BoardScreen

Компонент:

```tsx
BoardScreen
```

Это главный экран после входа.

Он отвечает за:

- загрузку проектов;
- загрузку доски;
- подключение к Socket.IO;
- отображение колонок;
- создание задач;
- перемещение задач;
- удаление задач;
- редактирование задач;
- отображение журнала событий;
- отображение статуса WebSocket.

### 45.4. ProjectRail

Компонент:

```tsx
ProjectRail
```

Это левая панель.

В ней есть:

- имя пользователя;
- email пользователя;
- список проектов;
- форма создания проекта;
- кнопка выхода.

### 45.5. ConnectionBar

Компонент:

```tsx
ConnectionBar
```

Он показывает:

- подключен ли WebSocket;
- текущую задержку;
- сколько участников онлайн.

Состояния:

```text
offline
connecting
online
```

### 45.6. BoardColumnView

Компонент:

```tsx
BoardColumnView
```

Это одна колонка Kanban-доски.

В ней есть:

- заголовок колонки;
- количество задач;
- список карточек;
- форма добавления новой задачи.

### 45.7. TaskCard

Компонент:

```tsx
TaskCard
```

Это карточка задачи.

Она показывает:

- приоритет;
- версию;
- название;
- описание;
- кнопки “Изменить” и “Удалить”.

Она также является draggable-элементом, то есть ее можно перетаскивать.

### 45.8. Drag-and-drop

Для drag-and-drop используется библиотека:

```text
@dnd-kit/core
```

В коде используются:

```ts
DndContext
useDraggable
useDroppable
PointerSensor
```

Упрощенно:

- `useDraggable` делает карточку перетаскиваемой;
- `useDroppable` делает колонку или карточку зоной, куда можно бросить;
- `DndContext` управляет всей drag-and-drop логикой;
- `onDragEnd` вызывается, когда пользователь отпустил карточку.

### 45.9. onDragEnd

Функция:

```ts
onDragEnd
```

Она вызывается после перетаскивания карточки.

Что делает:

1. Определяет, какую карточку перетащили.
2. Определяет, в какую колонку ее бросили.
3. Делает оптимистичное обновление интерфейса.
4. Отправляет REST-запрос `moveTask`.
5. Если сервер сообщил о конфликте, показывает сообщение.
6. Загружает актуальную доску с сервера.

### 45.10. Оптимистичное обновление

Оптимистичное обновление означает:

```text
Интерфейс сразу показывает изменение, не дожидаясь ответа сервера.
```

Это делает приложение более отзывчивым.

Но сервер всё равно остается главным источником истины.

После ответа сервера клиент загружает актуальное состояние.

### 45.11. Socket.IO на frontend

В `BoardScreen` есть подключение:

```ts
const socket: Socket = io("/", {
  auth: { token: auth.token },
  transports: ["websocket", "polling"]
});
```

После подключения frontend отправляет:

```ts
socket.emit("project:join", { projectId: activeProjectId });
```

И слушает события:

```ts
socket.on("sync:event", ...)
socket.on("presence:update", ...)
socket.on("disconnect", ...)
socket.on("connect", ...)
```

Когда приходит `sync:event`, frontend заново загружает доску.

Это простой и надежный способ синхронизации.

## 46. client/src/styles.css

Файл:

```text
client/src/styles.css
```

Это стили интерфейса.

В нем описано:

- общие цвета;
- шрифты;
- экран входа;
- левая панель проектов;
- рабочая область;
- Kanban-колонки;
- карточки задач;
- кнопки;
- формы;
- адаптивность для узких экранов.

CSS-классы:

```text
auth-shell
auth-panel
app-shell
project-rail
workspace
connection-bar
board-grid
board-column
task-card
event-feed
```

Например:

```css
.board-grid {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(260px, 320px);
}
```

Это делает Kanban-колонки горизонтальной сеткой.

## 47. Папка docs

Папка:

```text
docs/
```

Это документация для дипломной части.

Внутри:

```text
docs/architecture.md
docs/api.md
docs/testing-plan.md
```

## 48. docs/architecture.md

Файл:

```text
docs/architecture.md
```

Описывает архитектуру проекта.

Там есть:

- целевая аудитория;
- платформа;
- компоненты;
- поток перемещения карточки;
- разрешение конфликтов;
- разделение REST и WebSocket.

Этот файл можно использовать при написании практической главы диплома.

## 49. docs/api.md

Файл:

```text
docs/api.md
```

Описывает REST API и WebSocket-события.

Там указаны:

- маршруты авторизации;
- маршруты проектов;
- маршруты колонок;
- маршруты карточек;
- формат WebSocket-подключения;
- событие `sync:event`;
- событие `presence:update`.

## 50. docs/testing-plan.md

Файл:

```text
docs/testing-plan.md
```

Описывает план тестирования.

В нем есть:

- функциональные проверки;
- проверка синхронизации;
- проверка конфликтов;
- измерение задержки;
- нагрузочная проверка.

Этот файл полезен для раздела диплома “Тестирование”.

## 51. Папка dist

Папка:

```text
dist/
```

Она появляется после команды:

```powershell
npm.cmd run build
```

В ней лежит собранный проект.

Внутри:

```text
dist/client/
dist/server/
```

`dist/client` - собранный frontend.

`dist/server` - собранный backend.

Папку `dist` обычно не редактируют руками.

## 52. Лог-файлы server.out.log и server.err.log

Файлы:

```text
server.out.log
server.err.log
```

Они могут появиться, если сервер запускался через `Start-Process` с перенаправлением вывода.

`server.out.log` - обычный вывод сервера.

`server.err.log` - ошибки сервера.

Эти файлы не являются частью логики проекта.

Их можно использовать для диагностики, но обычно они не нужны для изучения кода.

## 53. README.md

Файл:

```text
README.md
```

Это краткое описание проекта.

Там есть:

- стек технологий;
- быстрый запуск;
- команды;
- что показывать на защите;
- краткое описание архитектуры;
- идея масштабирования.

## 54. KAK_ZAPUSTIT_I_POSMOTRET.md

Файл:

```text
KAK_ZAPUSTIT_I_POSMOTRET.md
```

Это практическая инструкция:

- как открыть сайт;
- как войти;
- как запустить сервер;
- как проверить WebSocket;
- что показать преподавателю.

Если нужно просто запустить проект, лучше начинать с него.

## 55. Как проходит регистрация

Путь данных:

```text
AuthScreen -> api.register -> POST /api/auth/register -> routes.ts -> auth.ts -> prisma -> PostgreSQL
```

Подробно:

1. Пользователь вводит email, имя и пароль.
2. Frontend отправляет данные на `/api/auth/register`.
3. Backend проверяет данные через `registerSchema`.
4. Backend проверяет, что email еще не занят.
5. Backend хеширует пароль через bcrypt.
6. Backend создает пользователя в таблице `User`.
7. Backend создает первый проект.
8. Backend возвращает JWT-токен.
9. Frontend сохраняет токен в `localStorage`.
10. Пользователь попадает на доску.

## 56. Как проходит вход

Путь данных:

```text
AuthScreen -> api.login -> POST /api/auth/login -> routes.ts -> auth.ts -> PostgreSQL
```

Подробно:

1. Пользователь вводит email и пароль.
2. Frontend отправляет запрос на `/api/auth/login`.
3. Backend ищет пользователя по email.
4. Backend сравнивает пароль с `passwordHash`.
5. Если пароль правильный, backend создает JWT.
6. Frontend сохраняет JWT.
7. Пользователь видит доску.

## 57. Как загружается доска

Путь данных:

```text
BoardScreen -> api.board -> GET /api/projects/:projectId/board -> getBoard -> PostgreSQL
```

Подробно:

1. Frontend получает список проектов.
2. Выбирает активный проект.
3. Запрашивает полную доску.
4. Backend проверяет доступ пользователя.
5. Backend загружает проект, участников, колонки и задачи.
6. Backend преобразует данные через `boardDto`.
7. Frontend отображает колонки и карточки.

## 58. Как создается задача

Путь данных:

```text
TaskCreateForm -> api.createTask -> POST /api/projects/:projectId/tasks -> createTask -> PostgreSQL -> TaskEvent -> WebSocket
```

Подробно:

1. Пользователь вводит название задачи.
2. Frontend отправляет REST-запрос.
3. Backend проверяет пользователя.
4. Backend проверяет проект.
5. Backend проверяет колонку.
6. Backend создает задачу.
7. Backend создает событие `TASK_CREATED`.
8. Backend отправляет событие через Socket.IO.
9. Другие вкладки получают событие.
10. Доска обновляется.

## 59. Как редактируется задача

Путь данных:

```text
TaskCard -> quickEdit -> api.updateTask -> PATCH /api/tasks/:taskId -> updateTask
```

Подробно:

1. Пользователь нажимает “Изменить”.
2. Вводит новое название.
3. Frontend отправляет `clientVersion`.
4. Backend проверяет текущую версию задачи.
5. Backend обновляет задачу.
6. Backend увеличивает `version`.
7. Backend создает событие `TASK_UPDATED`.
8. Backend отправляет WebSocket-событие.

## 60. Как перемещается задача

Путь данных:

```text
Drag-and-drop -> onDragEnd -> api.moveTask -> POST /api/tasks/:taskId/move -> moveTask -> PostgreSQL -> WebSocket
```

Подробно:

1. Пользователь перетаскивает карточку.
2. Frontend определяет новую колонку.
3. Frontend временно перемещает карточку на экране.
4. Frontend отправляет REST-запрос.
5. Backend рассчитывает новую позицию.
6. Backend обновляет `columnId`, `position`, `version`.
7. Backend создает событие `TASK_MOVED`.
8. Backend отправляет событие всем клиентам проекта.
9. Все вкладки обновляют доску.

Это главный демонстрационный сценарий диплома.

## 61. Как удаляется задача

Путь данных:

```text
TaskCard -> api.deleteTask -> DELETE /api/tasks/:taskId -> deleteTask
```

Подробно:

1. Пользователь нажимает “Удалить”.
2. Frontend отправляет DELETE-запрос.
3. Backend проверяет пользователя и проект.
4. Backend создает событие `TASK_DELETED`.
5. Backend удаляет задачу из PostgreSQL.
6. Backend отправляет WebSocket-событие.
7. Другие вкладки обновляются.

## 62. Как работает журнал событий

Журнал событий хранится в таблице:

```text
TaskEvent
```

Frontend получает события через:

```text
GET /api/projects/:projectId/events
```

И показывает их справа в блоке:

```text
Журнал событий
```

Зачем это нужно:

- показать историю изменений;
- подтвердить, что операции фиксируются на сервере;
- показать связь REST и WebSocket;
- использовать как материал для тестирования.

## 63. Что такое конфликт версий

Представим ситуацию:

1. Две вкладки открыли одну и ту же карточку версии `1`.
2. Первая вкладка изменила карточку.
3. Сервер сделал версию `2`.
4. Вторая вкладка всё еще думает, что версия `1`.
5. Вторая вкладка тоже отправляет изменение.

Это конфликт.

В проекте он решается так:

```text
Последнее действие применяется.
В событии фиксируется, что конфликт был разрешен.
```

Это называется:

```text
LAST_WRITE_WINS
```

Для диплома можно объяснить:

```text
Для Kanban-доски этот подход приемлем, потому что карточки являются независимыми объектами,
а не символами внутри одного общего текста.
```

## 64. Чем REST отличается от WebSocket в этом проекте

REST:

```text
Клиент сам отправляет запрос.
Сервер отвечает.
Соединение закрывается.
```

Пример:

```text
Создать задачу.
```

WebSocket:

```text
Клиент подключается один раз.
Соединение остается открытым.
Сервер может сам отправлять события.
```

Пример:

```text
Сообщить всем вкладкам, что задача перемещена.
```

В проекте:

```text
REST = команды.
WebSocket = уведомления.
PostgreSQL = постоянное состояние.
```

## 65. Что такое Prisma

Prisma - это ORM.

ORM означает:

```text
Object-Relational Mapping
```

Проще:

```text
Это инструмент, который позволяет работать с таблицами базы как с объектами в коде.
```

Без Prisma пришлось бы писать SQL вручную:

```sql
SELECT * FROM "Task" WHERE "id" = ...
```

С Prisma можно писать:

```ts
prisma.task.findUnique({
  where: { id: taskId }
});
```

Это удобнее и безопаснее.

## 66. Что такое Express

Express - это backend-фреймворк для Node.js.

Он позволяет создавать REST API.

Пример:

```ts
router.get("/health", asyncRoute(async (_req, res) => {
  res.json({ ok: true });
}));
```

Это значит:

```text
Когда приходит GET-запрос на /health, вернуть JSON.
```

## 67. Что такое Socket.IO

Socket.IO - библиотека для real-time соединений.

Она использует WebSocket и добавляет удобный API.

В проекте Socket.IO нужен для:

- подключения клиента к серверу;
- входа пользователя в комнату проекта;
- отправки события `sync:event`;
- presence-обновлений;
- измерения задержки.

## 68. Что такое React

React - библиотека для создания пользовательских интерфейсов.

Интерфейс разбивается на компоненты:

- `App`;
- `AuthScreen`;
- `BoardScreen`;
- `TaskCard`;
- `BoardColumnView`.

Компонент - это часть интерфейса со своей логикой и отображением.

## 69. Что такое Vite

Vite - инструмент для разработки frontend.

Он:

- быстро запускает dev-сервер;
- обновляет страницу при изменении кода;
- собирает frontend для production.

Команда:

```powershell
npm.cmd run dev
```

запускает Vite на:

```text
http://localhost:5173
```

## 70. Что такое TypeScript

TypeScript - это JavaScript с типами.

Пример типа:

```ts
type Task = {
  id: string;
  title: string;
  version: number;
};
```

Это помогает:

- легче понимать код;
- ловить ошибки до запуска;
- удобнее работать в IDE;
- лучше поддерживать проект.

## 71. Что такое bcrypt

bcrypt используется для хеширования паролей.

Пользователь вводит пароль:

```text
demo12345
```

В базе хранится не он, а хеш:

```text
$2b$12$...
```

Когда пользователь входит, bcrypt сравнивает введенный пароль с хешем.

## 72. Что такое Zod

Zod - библиотека для проверки данных.

Она проверяет, что клиент отправил правильные данные.

Например:

- email похож на email;
- пароль не слишком короткий;
- `columnId` является UUID;
- приоритет входит в допустимый список.

## 73. Что такое dnd-kit

dnd-kit - библиотека для drag-and-drop в React.

Она позволяет перетаскивать карточки.

В проекте она используется для Kanban-доски.

## 74. Что такое CORS

CORS - механизм безопасности браузера.

Когда frontend и backend работают на разных адресах, браузер проверяет, разрешены ли такие запросы.

В режиме разработки:

```text
Frontend: http://localhost:5173
Backend:  http://localhost:4000
```

Поэтому backend разрешает запросы с `CLIENT_ORIGIN`.

## 75. Что происходит при запуске npm.cmd run dev

Команда:

```powershell
npm.cmd run dev
```

запускает:

```text
server:dev
client:dev
```

То есть:

1. Backend в watch-режиме.
2. Frontend через Vite.

Watch-режим означает:

```text
Если код изменился, сервер автоматически перезапустится.
```

## 76. Что происходит при запуске npm.cmd run build

Команда:

```powershell
npm.cmd run build
```

делает две вещи:

1. Проверяет и компилирует backend TypeScript.
2. Собирает frontend через Vite.

После этого появляется папка:

```text
dist/
```

## 77. Что происходит при запуске npm.cmd run start

Команда:

```powershell
npm.cmd run start
```

запускает собранный backend:

```text
node dist/server/src/index.js
```

Backend также отдает собранный frontend из:

```text
dist/client
```

Поэтому в production-режиме достаточно открыть:

```text
http://localhost:4000
```

## 78. Как проверить проект вручную

Минимальная проверка:

1. Открыть `http://localhost:4000`.
2. Войти как `demo@example.com`.
3. Создать задачу.
4. Перетащить задачу.
5. Открыть вторую вкладку.
6. Повторить перемещение.
7. Убедиться, что изменения синхронизируются.

Проверка backend:

```text
http://localhost:4000/api/health
```

Проверка сборки:

```powershell
npm.cmd run build
```

Проверка тестов:

```powershell
npm.cmd test
```

## 79. Как объяснить проект на защите

Можно сказать так:

```text
В практической части разработано веб-приложение для командного управления задачами.
Архитектура построена на гибридном подходе: REST API используется для атомарных CRUD-операций,
а WebSocket используется для доставки событий реального времени.
Состояние хранится в PostgreSQL. Для доступа к базе используется Prisma ORM.
Клиентская часть реализована на React и поддерживает drag-and-drop.
При каждом изменении сервер сохраняет данные в базе, создает событие TaskEvent
и рассылает его всем подключенным клиентам соответствующего проекта.
```

Короткая версия:

```text
REST надежно меняет состояние, WebSocket быстро сообщает об изменениях,
PostgreSQL хранит данные, React отображает доску.
```

## 80. Что особенно важно для оценки "5"

В проекте есть вещи, которые хорошо выглядят для диплома:

- настоящая PostgreSQL-база, а не файл;
- JWT-аутентификация;
- REST API;
- WebSocket-синхронизация;
- drag-and-drop интерфейс;
- журнал событий;
- версионирование задач;
- стратегия разрешения конфликтов;
- Prisma-миграции;
- seed-данные;
- документация;
- тест алгоритма позиционирования;
- заготовка Redis для масштабирования.

## 81. Какие файлы читать в первую очередь

Если вы новичок, лучше читать проект в таком порядке:

1. `KAK_ZAPUSTIT_I_POSMOTRET.md`
2. `README.md`
3. `PODROBNOE_OPISANIE_PROEKTA_DLYA_NOVICHKA.md`
4. `prisma/schema.prisma`
5. `server/src/routes.ts`
6. `server/src/board.service.ts`
7. `server/src/realtime.ts`
8. `client/src/main.tsx`
9. `docs/architecture.md`
10. `docs/testing-plan.md`

## 82. Главная мысль проекта

Самое важное, что нужно понять:

```text
Клиент не хранит истину.
Истина хранится на сервере и в PostgreSQL.
REST API изменяет эту истину.
WebSocket сообщает другим клиентам, что истина изменилась.
```

Именно это соответствует теме дипломной работы.
