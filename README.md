# CampusLearn — Centralized Platform for Academic Resources & Collaborative Learning

A responsive student/faculty/admin project built with **Node.js + Express + SQLite + vanilla HTML/CSS/JavaScript**. It runs on a laptop and a mobile browser. SQLite is used instead of requiring a separate MongoDB installation, so the first setup is simpler.


## Premium portal and notification upgrade

This build opens with a welcome page and separate Administrator, Student and Faculty sign-in portals. The server validates the selected role during login. The dashboard uses a soft light-green workspace palette, a light-blue welcome page, mint-green sign-in screens, and responsive layouts for phones, tablets and laptops.

### Notifications and email
- Students receive in-app notifications when matching faculty publish study materials, assignments or quizzes. Each notification has an Open update action that takes the student to the relevant page.
- Admin announcements can target students, faculty or everyone. Attendance below 45% creates a student warning.
- The same events attempt Gmail delivery when SMTP is configured in `.env`; in-app notifications continue to work if SMTP is not configured.
- Configure `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER`, `SMTP_PASS` (Google App Password), and `SMTP_FROM`. Never commit `.env`.

### Passwords, quiz and personal drive
- Forgot password uses email verification only; SMS/mobile selection has been removed from the interface.
- Password changes and quiz submissions show explicit success messages.
- Student personal drive supports PDF/image/video/text previews, filename-preserving downloads, and embedded YouTube previews.

### Deployment to Render, Railway and VPS

See [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) for complete deployment steps, persistent-volume configuration, domain/HTTPS setup, backups, and the SQLite single-instance limitation. The included `render.yaml`, `railway.json`, `Dockerfile`, and `compose.yaml` provide hosting configuration.

## Quick run (Windows PowerShell)
1. Extract the ZIP and open the inner `academic-platform` folder in VS Code.
2. Run `Copy-Item .env.example .env` only if `.env` does not already exist.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:3000`.

## Included roles and features

### Super Admin
- Initial admin account is created automatically on the first run.
- Create faculty and student accounts; there is no public registration endpoint/page.
- Assign faculty to a subject and maintain subject code, branch, semester, and 2022/2025 scheme.
- View student and faculty accounts in separate registered-account lists, including saved mobile numbers.
- Upload student exam/internal marks and monthly attendance, with a selected-month summary showing subject totals and weighted attendance across all subjects.
- Allot weekly class timetable slots by subject/semester; assigned faculty and students see their own schedules. Conflicting subject/faculty slots are rejected.
- Manage accounts/subjects/resources.

### Faculty
- Sign in using credentials created by the Super Admin.
- View assigned subjects.
- Publish syllabus, notes, question papers, reference materials and external links.
- Publish subject assignments; view submissions and grade them.
- Create auto-graded multiple-choice quizzes/mock tests (the starter UI currently creates one question per quiz).

### Student
- Sign in using credentials created by the Super Admin.
- Subjects are filtered by the student's branch, semester and scheme.
- View the semester timetable.
- Read PDFs in an embedded study-material viewer and read extracted slide text from PPTX presentations inside the Study Materials section. Legacy PPT files can be downloaded/opened in a compatible office app.
- View/download resources, open external links, submit assignments, take quizzes, and view results, assignment marks and attendance.
- Change passwords using the current password and a new password; this works without SMTP/SMS configuration.
- Use Forgot password on the sign-in page to reset a forgotten password with a verification code.
- Submitted assignments display a persistent Submitted status and cannot be submitted a second time.

### Personal study assistant
- Uses the OpenAI API to answer student questions. **Ollama is not required or used.**
- The server sends the question and relevant matched subject/resource context to the configured Google Gemini model.
- If the key is missing, invalid, out of quota, or the API cannot be reached, the assistant shows a clear error instead of silently switching to offline database search.
- Do not place an API key in frontend JavaScript. Keep it in `.env` on the server.

## Requirements
- Windows 10/11, macOS or Linux
- Node.js 18 or newer (LTS recommended)
- Internet for the first `npm install`; the basic app thereafter runs locally. Optional online AI requires internet and a valid API key.

## Run on Windows (simple steps)

1. Install Node.js LTS from https://nodejs.org/ . During installation, keep the option to add Node to PATH enabled.
2. Extract the ZIP file into a folder, for example `C:\CampusLearn`.
3. Open that folder in VS Code: **File → Open Folder**.
4. Open the VS Code terminal: **Terminal → New Terminal**.
5. Copy the environment file:
   - PowerShell: `Copy-Item .env.example .env`
   - Command Prompt: `copy .env.example .env`
6. Install dependencies:
   ```bash
   npm install
   ```
7. Start the server:
   ```bash
   npm start
   ```
8. In Chrome/Edge, open **http://localhost:3000**.

### First Super Admin login
Default development credentials (change these before using real student data):
- Email: `admin@example.com`
- Password: `Admin@12345`

The first-run account uses `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The SQLite database is created as `academic.db`. Admin self-sign-up is intentionally disabled: the Super Admin account is bootstrapped by the server. If the database already exists and the admin login is wrong, stop the server and run `node reset-admin.js your-email@example.com YourNewPassword123` from this project folder. The script updates the existing admin (or creates one), and does not change student/faculty accounts. Then run `npm start` again.

## Password verification setup (important)

Changing a password while signed in requires the current password and works without a delivery provider. The Forgot password recovery flow still uses OTP and requires a delivery provider. The app does not display OTPs in the browser or console.

### Email OTP
1. Copy `.env.example` to `.env` if you have not already done so.
2. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` with credentials from your email provider. This setup is needed only for **Forgot password** recovery, not for a signed-in user changing their password. For Gmail, use an App Password where supported; do not use your normal Gmail password.
3. Restart the server after editing `.env`.

### Optional SMS OTP
Configure `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` with a valid Twilio account/sender. Save each user's mobile number in international format (for example `+91...`) when the Super Admin creates the account. SMS charges and provider restrictions may apply.

OTP codes expire after 10 minutes and are limited to five requests per account in a 15-minute period.

## Fixes in this build
- Faculty account registration works even though student-only branch/semester/scheme fields are hidden. Hidden fields are disabled for faculty and the backend normalizes/validates the account role and email.
- The account form prevents duplicate submit handlers and shows the newly created account ID.
- Admin, faculty, and students can change their own password by verifying the current password; email/SMS OTP is not needed for this signed-in flow.
- Searching account lists no longer reattaches every page form handler and cause duplicate form submissions.

## First setup workflow
1. Sign in as Super Admin.
2. Open **Manage accounts** and create faculty accounts with temporary passwords of at least 8 characters.
3. Create student accounts and set branch, semester, scheme (2022/2025), and optionally roll number.
4. Open **Subjects & faculty**, add subject codes/names, and assign each subject to a faculty member.
5. Open **Upload results** and **Monthly attendance** to add academic records.
6. Faculty sign in, open **Learning resources**, and publish syllabus/notes/question papers or links; then create assignments/quizzes.
7. Students sign in and view their subjects, resources, assignments, marks, attendance, quizzes and AI assistant.

## Use on phones and laptops on the same Wi-Fi (local testing only)
- Start the server on your laptop with `npm start`.
- Run `ipconfig` in Windows Terminal and find the laptop's IPv4 Address.
- On the phone connected to the **same Wi-Fi**, open `http://LAPTOP-IP-ADDRESS:3000`.

## Hosting on Render, Railway and Linux VPS

Follow [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) for the full current instructions. This package includes a Dockerfile, Render Blueprint, Railway Docker configuration, and a Docker Compose setup for Ubuntu VPS. All cloud deployments must mount persistent storage at `/data` and set `DATA_DIR=/data`.

**SQLite limitation:** each deployment has its own data. Keep one app instance per persistent volume. Do not run multiple replicas against one SQLite database. To share one live database across Render, Railway and VPS at the same time, migrate to PostgreSQL and shared object storage first.

## Google Gemini API setup (AI Study Assistant)
1. Copy `.env.example` to `.env` if you have not already done so.
2. Open `.env` and set `GEMINI_API_KEY=your_actual_api_key` and `GEMINI_MODEL=gemini-2.5-flash`. Use a model available to your API account.
3. Save `.env`, stop the server with `Ctrl+C`, then restart with `npm start`.
4. Keep `.env` private. Do not upload it to GitHub or share it in screenshots. API use may incur provider charges.
5. If the API fails, the assistant now displays a clear error (missing key, invalid key, quota/rate limit, model access, or connection problem) rather than silently reverting to offline search. No Ollama installation is needed.

## Data and uploads
- Database: `academic.db` locally, or `$DATA_DIR/academic.db` when `DATA_DIR` is configured
- Uploaded study materials and assignment files: `$DATA_DIR/uploads/`
- Student personal-drive uploads: `$DATA_DIR/private-drive/` (served only through authenticated routes)
- Back up both before moving the project. Do not delete the database while the server is running.
- Uploaded resource limit: 15 MB per file. Allowed types include PDF, Office documents, text, common images and ZIP.

## Important project/demo limitations
This is a runnable academic project starter suitable for demonstration and further college-project development, not a production student-information system. Before real deployment, add HTTPS, secure password reset, stronger rate limits, audit logs, privacy/retention rules, backups, malware scanning, stronger upload validation, and review authorization/data handling. Admin result uploads currently apply to any student/subject pair selected; verify matching branch/semester before using real data. The quiz creation screen currently supports one MCQ per quiz, though the backend can store multiple questions. The AI assistant uses matched platform context and should not be treated as an official source for exam rules or marks.

## Troubleshooting
- `npm is not recognized`: reinstall Node.js LTS and reopen VS Code/terminal.
- Port 3000 busy: set `PORT=3001` in `.env`, restart, then open `http://localhost:3001`.
- Admin login fails: stop the server and run `node reset-admin.js your-email@example.com YourNewPassword123`; restart with `npm start` and use the exact email/password you supplied. Admin self-sign-up is disabled by design. Deleting `academic.db` resets all accounts/results/resources, so use that only if you intentionally want to erase the project data.
- `npm install` native dependency error: confirm the package is `better-sqlite3` version 12 or newer and use a current Node.js LTS release. If Windows still compiles from source, install Visual Studio Build Tools with **Desktop development with C++** and a Windows SDK, then retry `npm install`.
- AI Study Assistant shows an API error: confirm `GEMINI_API_KEY` is set in `.env` (not `.env.example`), restart the server, check the model name, internet connection, and API billing/credits. The browser UI should display the reason returned by the backend.

## Project structure
```text
academic-platform/
├── server.js             # API, authentication, database, role permissions
├── package.json
├── .env.example
├── README.md
├── academic.db           # generated on first run; not shipped
├── uploads/              # public learning materials/submissions
├── private-drive/        # private student-drive files (not publicly served)
└── public/
    ├── index.html
    ├── style.css         # responsive desktop/mobile design
    └── app.js            # role-based screens and API calls
```

## Recent UI and account improvements

- Super Admin can edit an existing student or faculty profile from **Manage accounts → Edit**. Leave the temporary-password field blank to keep the current password; enter a new password (8+ characters) only when you want to reset it.
- Monthly attendance below **45%** is flagged. Admin sees a warning after saving that attendance record, and students see a warning on their dashboard and attendance page after signing in.
- Students have a separate **My personal drive** page for personal images, PDFs, documents, ZIP files, videos (MP4/WebM/MOV) and web links. Items are listed per student account and can be removed by their owner. Upload limit is 100 MB per file.
- Password-change success and validation/server errors are shown inline in the password form as well as being accessible to screen readers, instead of relying on a transient popup.
- Responsive layout refinements improve touch targets, cards, tables and form layouts on phones and laptops.

## Updating an existing installation

1. Stop the running server with `Ctrl+C`.
2. Back up your `academic.db`, `.env`, and `uploads` folder before replacing files.
3. Copy the updated project files over your existing project. Keep your existing `.env`, `academic.db`, and uploaded files.
4. Run `npm install` from the project directory.
5. Run `npm start` and open the local address printed in the terminal (typically `http://localhost:3000`).
6. On a phone connected to the same Wi-Fi, open `http://YOUR-COMPUTER-LAN-IP:3000`; allow Node.js through Windows Firewall for private networks if prompted. Both devices must be on the same network.

The personal drive uses the existing `uploads` directory and the new `drive_items` table is created automatically when the server starts. Do not delete `academic.db` if you want to keep existing accounts and records.

## Notification Centre Upgrade (October 2026)

This version adds a persistent in-app notification centre to the existing project. The notification table is created automatically when the server starts; no manual SQL migration is required.

### Included notification features

- **Faculty assignment alerts:** students matching the subject's branch, semester and scheme are notified when faculty publish an assignment, including its due date.
- **Faculty quiz alerts:** matching students are notified when a quiz/mock test is published.
- **Study material alerts:** matching students are notified when new course resources are published.
- **Automatic low-attendance warning:** when an admin saves a monthly attendance record below 45%, the student receives a warning with the subject, month and recorded percentage. If the admin corrects that same record to 45% or above, its earlier warning is marked read.
- **Admin announcements:** Admin → Notifications & announcements lets the admin send a title, message and priority to all students, all faculty, or everyone.
- **Read/unread management:** each user sees their own notification list, can mark individual notifications read, or mark all as read. Users cannot access other accounts' notifications.

### Run the upgraded project on Windows

1. Extract the ZIP file.
2. Open the extracted `academic-platform` folder in VS Code.
3. Open **Terminal → New Terminal** in VS Code.
4. If `.env` does not exist, run `Copy-Item .env.example .env` in PowerShell.
5. Install dependencies with `npm install`.
6. Start the server with `npm start`.
7. Open `http://localhost:3000` in your browser.
8. Sign in with your existing account. For a fresh local database, the default admin is configured through `.env.example`; change its password and `JWT_SECRET` before real use.

### Test the new notifications

1. Sign in as admin and create a test student and faculty account with matching branch, semester and scheme.
2. Assign a subject to the faculty account.
3. Sign in as faculty and publish an assignment, quiz and study material for that subject.
4. Sign in as the student and open **Notifications** to see the new alerts.
5. As admin, save attendance such as 4 present days out of 10 total days (40%). Sign in as that student and check for **Attendance below 45%**.
6. As admin, open **Notifications & announcements**, write an important message, choose an audience and send it. The target accounts will see it in their notification centre.

Notifications are in-app messages, not SMS/email push notifications. Users see new messages when they open or refresh the Notifications page. Student targeting for staff-created content follows the same branch/semester/scheme matching used by the existing academic pages.
