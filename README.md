# CASPAA — Assessments (M14)

Backend for the Assessments module: teachers create assignments/CBTs, students submit and get graded (MCQ/True-False auto-graded on submit, short-answer teacher-marked), teachers mark submissions with inline pin/pen/highlight annotations, grade, and return work — which notifies the student and every linked parent. Students can resubmit returned work, pre-populated from their previous answer. Admins see every teacher's assignments/CBTs.

**Stack:** NestJS 11 · Prisma 6 (PostgreSQL) · Passport JWT · class-validator · Jest

## Setup

```powershell
npm install
copy .env.example .env
```
Edit `.env`: set `DATABASE_URL` to your Postgres connection string and `JWT_SECRET` to a random string of 32+ characters.

```powershell
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start
```
Server runs at `http://localhost:3000`.

## Seeded accounts

All passwords are `password123`.

| Role    | Email                |
|---------|-----------------------|
| Teacher | teacher@caspaa.test  |
| Student | student@caspaa.test  |
| Parent  | parent@caspaa.test   |
| Admin   | admin@caspaa.test    |

## Verifying each acceptance criterion

Run these in order — each step uses IDs returned by the one before it. `TEACHER`, `STUDENT`, `PARENT`, `ADMIN` are JWTs from `POST /auth/login`.

```bash
TEACHER=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"teacher@caspaa.test","password":"password123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
STUDENT=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"student@caspaa.test","password":"password123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
PARENT=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"parent@caspaa.test","password":"password123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
ADMIN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"admin@caspaa.test","password":"password123"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).accessToken))")
CLASS_ID=$(node -e "const{PrismaClient}=require('@prisma/client');new PrismaClient().class.findFirst().then(c=>{console.log(c.id);process.exit()})")
```

### 1. Image pin at click point — pin at exact % coordinates, reloads on re-open

```bash
ASSIGNMENT_ID=$(curl -s -X POST http://localhost:3000/assessments -H "Authorization: Bearer $TEACHER" -H "Content-Type: application/json" -d '{"title":"Essay","type":"ASSIGNMENT","classId":"'$CLASS_ID'","subject":"English","dueDate":"2026-12-31T00:00:00.000Z"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")
SUBMISSION_ID=$(curl -s -X POST http://localhost:3000/assessments/$ASSIGNMENT_ID/submissions -H "Authorization: Bearer $STUDENT" -H "Content-Type: application/json" -d '{"textContent":"my essay"}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

curl -s -X POST http://localhost:3000/submissions/$SUBMISSION_ID/annotations -H "Authorization: Bearer $TEACHER" -H "Content-Type: application/json" -d '{"type":"PIN","x":30,"y":40,"color":"#ff0000","text":"check this"}'

# reload — confirm the same x/y comes back
curl -s http://localhost:3000/submissions/$SUBMISSION_ID/annotations -H "Authorization: Bearer $TEACHER"
```

### 2. Return notifies student+parent — both get grade + feedback

```bash
curl -s -X PATCH http://localhost:3000/submissions/$SUBMISSION_ID/grade -H "Authorization: Bearer $TEACHER" -H "Content-Type: application/json" -d '{"score":75,"status":"SATISFACTORY","feedback":"Good start"}'
curl -s -X POST http://localhost:3000/submissions/$SUBMISSION_ID/return -H "Authorization: Bearer $TEACHER"

# both recipients have a RETURNED notification
curl -s http://localhost:3000/notifications -H "Authorization: Bearer $STUDENT"
curl -s http://localhost:3000/notifications -H "Authorization: Bearer $PARENT"
```

### 3. Resubmit always available on returned work — modal pre-populates previous answer

```bash
# pre-population data: the client fetches the returned submission's own content
curl -s http://localhost:3000/submissions/$SUBMISSION_ID -H "Authorization: Bearer $STUDENT"

curl -s -X POST http://localhost:3000/submissions/$SUBMISSION_ID/resubmit -H "Authorization: Bearer $STUDENT" -H "Content-Type: application/json" -d '{"textContent":"my improved essay"}'
```

### 4. MCQ/TF auto-graded — score immediate; short-answer pending until marked

```bash
CBT_ID=$(curl -s -X POST http://localhost:3000/assessments -H "Authorization: Bearer $TEACHER" -H "Content-Type: application/json" -d '{"title":"Quick MCQ","type":"CBT","classId":"'$CLASS_ID'","subject":"Math","dueDate":"2026-12-31T00:00:00.000Z","questions":[{"type":"MCQ","text":"2+2?","options":["3","4"],"correctAnswer":"4"}]}')
Q_ID=$(echo "$CBT_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).questions[0].id))")
CBT_ID=$(echo "$CBT_ID" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

# response shows status: "GRADED" and autoScore immediately, no teacher action needed
curl -s -X POST http://localhost:3000/assessments/$CBT_ID/submissions -H "Authorization: Bearer $STUDENT" -H "Content-Type: application/json" -d '{"answers":[{"questionId":"'$Q_ID'","response":"4"}]}'
```

### 5. Overdue CBT — badge shown; cannot submit overdue

```bash
OVERDUE_CBT=$(curl -s -X POST http://localhost:3000/assessments -H "Authorization: Bearer $TEACHER" -H "Content-Type: application/json" -d '{"title":"Old Quiz","type":"CBT","classId":"'$CLASS_ID'","subject":"Math","dueDate":"2020-01-01T00:00:00.000Z","questions":[{"type":"MCQ","text":"2+2?","options":["3","4"],"correctAnswer":"4"}]}' | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).id))")

# badge: isOverdue: true on the list response
curl -s http://localhost:3000/assessments -H "Authorization: Bearer $TEACHER"

# blocked: 403
curl -s -w "\nHTTP %{http_code}\n" -X POST http://localhost:3000/assessments/$OVERDUE_CBT/submissions -H "Authorization: Bearer $STUDENT" -H "Content-Type: application/json" -d '{"answers":[]}'
```

### 6. Admin oversight — all teachers' assignments/CBTs visible

```bash
curl -s http://localhost:3000/assessments -H "Authorization: Bearer $ADMIN"
```

## Tests

```powershell
npm run test
npm run test:e2e
```
