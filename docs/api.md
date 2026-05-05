# REST API И WebSocket-События

## Авторизация

`POST /api/auth/register`

```json
{
  "email": "user@example.com",
  "name": "User",
  "password": "password123"
}
```

`POST /api/auth/login`

```json
{
  "email": "demo@example.com",
  "password": "demo12345"
}
```

Ответ содержит JWT. Защищенные запросы используют заголовок:

```http
Authorization: Bearer <token>
```

## Проекты И Доска

- `GET /api/projects` - список проектов пользователя.
- `POST /api/projects` - создание проекта.
- `GET /api/projects/:projectId/board` - полное состояние доски.
- `GET /api/projects/:projectId/events` - журнал событий проекта.
- `GET /api/projects/:projectId/metrics` - простые метрики событий.

## Роли

- `OWNER` - владелец проекта, управляет администраторами, участниками, группами, колонками и задачами.
- `ADMIN` - администратор, управляет обычными участниками, группами из обычных участников, колонками и задачами.
- `MEMBER` - исполнитель, видит доску и перемещает только задачи, назначенные ему или его группе.

## Участники

`POST /api/projects/:projectId/members`

```json
{
  "email": "worker@example.com",
  "name": "Исполнитель 3",
  "password": "worker33333",
  "role": "MEMBER"
}
```

Если пользователя с таким email нет, сервер создает аккаунт. Если `password` не передан, создается временный пароль, который возвращается в `temporaryPassword`.

Событие: `MEMBER_ADDED`.

`PATCH /api/projects/:projectId/members/:memberId`

```json
{
  "role": "ADMIN"
}
```

Событие: `MEMBER_UPDATED`.

`DELETE /api/projects/:projectId/members/:memberId`

Событие: `MEMBER_REMOVED`.

## Группы Исполнителей

`POST /api/projects/:projectId/groups`

```json
{
  "name": "Frontend group",
  "memberIds": ["project-member-uuid"]
}
```

Событие: `GROUP_CREATED`.

`PATCH /api/projects/:projectId/groups/:groupId`

```json
{
  "name": "Frontend review group",
  "memberIds": ["project-member-uuid"]
}
```

Событие: `GROUP_UPDATED`.

`DELETE /api/projects/:projectId/groups/:groupId`

Событие: `GROUP_DELETED`.

## Колонки

- `POST /api/projects/:projectId/columns` - создать колонку, событие `COLUMN_CREATED`.
- `PATCH /api/columns/:columnId` - изменить колонку, событие `COLUMN_UPDATED`.
- `DELETE /api/columns/:columnId` - удалить колонку, событие `COLUMN_DELETED`.

## Карточки

`POST /api/projects/:projectId/tasks`

```json
{
  "columnId": "uuid",
  "title": "Название задачи",
  "description": "Описание",
  "priority": "MEDIUM",
  "assigneeId": "optional-user-uuid",
  "assigneeGroupId": null
}
```

Событие: `TASK_CREATED`.

`PATCH /api/tasks/:taskId`

```json
{
  "title": "Новое название",
  "priority": "HIGH",
  "clientVersion": 2
}
```

Событие: `TASK_UPDATED`.

`POST /api/tasks/:taskId/move`

```json
{
  "columnId": "target-column-uuid",
  "beforeTaskId": "optional-task-uuid",
  "clientVersion": 2
}
```

Можно передать `beforeTaskId` или `afterTaskId`, но не оба поля одновременно. При успешном перемещении сервер увеличивает `version` карточки.

Событие: `TASK_MOVED`.

`DELETE /api/tasks/:taskId`

Событие: `TASK_DELETED`.

## Формат События

```json
{
  "id": "event-uuid",
  "projectId": "project-uuid",
  "taskId": "task-uuid-or-null",
  "actorId": "user-uuid-or-null",
  "type": "TASK_MOVED",
  "payload": {},
  "createdAt": "2026-04-18T12:00:00.000Z"
}
```

## WebSocket

Клиент подключается к Socket.IO с JWT:

```ts
io("/", {
  auth: { token }
});
```

После подключения клиент входит в комнату проекта:

```ts
socket.emit("project:join", { projectId }, (response) => {
  // response.ok === true
});
```

Основное событие синхронизации:

```ts
socket.on("sync:event", (event) => {
  // event.type: TASK_CREATED, TASK_MOVED, MEMBER_ADDED...
});
```

Presence:

```ts
socket.on("presence:update", ({ projectId, users }) => {});
```

Измерение задержки:

```ts
socket.timeout(1500).emit("ping", { sentAt: Date.now() }, (_error, response) => {
  const latency = Date.now() - response.sentAt;
});
```
