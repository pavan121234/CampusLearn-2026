# CampusLearn deployment guide (Render, Railway and Linux VPS)

This release is configured for Node 20, Docker, a writable persistent data directory and responsive phone/tablet/laptop browsers.

## Important storage and scaling rule

CampusLearn currently uses **SQLite** and stores uploaded files on disk. The application now separates the immutable application files (`/app` or the release folder) from writable data (`DATA_DIR`). This is necessary when a hosting provider mounts a persistent volume at `/data`.

- Use **one running application instance per deployment** with its own persistent volume.
- Render, Railway and a VPS deployed independently will each have their **own separate database and uploads**. They do not synchronize with one another.
- Do not run multiple replicas against the same SQLite file. SQLite on a shared network volume is not a safe multi-server database architecture.
- If all three servers must serve the same live campus data at the same time, the next architecture step is migrating the database to managed PostgreSQL and moving uploads to shared object storage (S3-compatible). That migration is not silently simulated by this package.

## 1. Prepare the project and secrets

1. Extract the ZIP and open the `academic-platform` folder (the folder containing `package.json`) in VS Code.
2. Copy `.env.example` to `.env` for local testing.
3. Before any production deployment, create a unique password of at least 12 characters for `ADMIN_PASSWORD` and a random `JWT_SECRET` of at least 32 characters. Never commit `.env` to GitHub.
4. Configure Gmail only if you want email notifications and password-recovery codes. Use a Google App Password, not your normal Gmail password.

Generate a JWT secret locally with PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Production variables:

```env
NODE_ENV=production
DATA_DIR=/data
JWT_SECRET=PASTE_A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS
ADMIN_NAME=Super Admin
ADMIN_EMAIL=your-admin-email@example.com
ADMIN_PASSWORD=USE_A_UNIQUE_PASSWORD_AT_LEAST_12_CHARACTERS
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=your-google-app-password
SMTP_FROM=your-gmail@gmail.com
```

`PORT` is assigned by Render/Railway automatically. On VPS Docker it is set to 3000 by the compose file.

## 2. Deploy on Render

**Persistent storage note:** Render's free web service does not provide a persistent disk. The `render.yaml` in this project requests a Starter web service with a 1 GB disk mounted at `/data`; check current Render pricing before creating it.

1. Push the complete project folder to a GitHub repository. Include `Dockerfile`, `render.yaml`, `package.json`, `package-lock.json`, `server.js`, `public/` and the other source files. Do not push `.env`, `academic.db`, or uploaded private data.
2. In Render, choose **New → Blueprint** and connect the repository, or create a **Web Service** using the Docker runtime and the included `Dockerfile`.
3. If using the Blueprint, review `render.yaml`. Ensure the persistent disk mount path is exactly `/data`.
4. In the Render Environment page, enter `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Enter the Gmail variables if email delivery is required. Keep the generated `JWT_SECRET`; do not replace it with a short value.
5. Confirm `NODE_ENV=production` and `DATA_DIR=/data`.
6. Deploy and wait for the health check at `/api/health` to return JSON with `ok: true`.
7. Open the Render HTTPS URL on a laptop and a phone. Create test accounts and test file upload/download.
8. Do not remove the disk or create a second service without planning a data migration. Keep independent backups of the volume.

## 3. Deploy on Railway

1. Push the same project to GitHub and create a new Railway project from that repository.
2. Railway detects `railway.json` and builds with the included Dockerfile.
3. Open the service's **Volumes** settings and create a persistent volume.
4. Set its mount path to exactly `/data`.
5. In **Variables**, add:

```env
NODE_ENV=production
DATA_DIR=/data
JWT_SECRET=<random secret of 32+ characters>
ADMIN_NAME=Super Admin
ADMIN_EMAIL=<your admin email>
ADMIN_PASSWORD=<unique password of 12+ characters>
```

6. Add `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` if Gmail delivery is needed.
7. Deploy. Confirm the deployment health check `/api/health` succeeds.
8. Generate a Railway public domain (or connect your own domain) and test from a phone using mobile data.
9. Keep the volume attached during redeploys. A new service without the old volume starts with a new database.

## 4. Deploy on a Linux VPS (Ubuntu 22.04/24.04)

This route uses Docker Compose and Nginx. Replace `campuslearn.example.com` with your domain.

1. Point your domain's DNS `A` record to the VPS public IPv4 address.
2. SSH into the VPS and install Docker Engine plus the Docker Compose plugin using Docker's official Ubuntu installation instructions.
3. Create an application folder and upload/clone this project into it:

```bash
sudo mkdir -p /opt/campuslearn
sudo chown -R "$USER":"$USER" /opt/campuslearn
cd /opt/campuslearn
# Clone your repository here, or upload/extract the project contents here.
```

4. Create persistent data folders and grant the container's Node user (UID 1000) access:

```bash
sudo mkdir -p /var/lib/campuslearn/uploads /var/lib/campuslearn/private-drive
sudo chown -R 1000:1000 /var/lib/campuslearn
```

5. Create `.env` in `/opt/campuslearn` with the production variables shown above. Set `DATA_DIR=/data`; do not put the database in the Git repository.
6. Build and start the service:

```bash
docker compose up -d --build
```

7. Check logs and health:

```bash
docker compose logs -f campuslearn
curl http://127.0.0.1:3000/api/health
```

8. Install Nginx and copy `deploy/nginx-campuslearn.conf` to `/etc/nginx/sites-available/campuslearn`. Change `server_name` to your domain, enable the site, test and reload:

```bash
sudo ln -s /etc/nginx/sites-available/campuslearn /etc/nginx/sites-enabled/campuslearn
sudo nginx -t
sudo systemctl reload nginx
```

9. Install Certbot for your Linux distribution and issue a Let's Encrypt certificate for the domain. Then open `https://campuslearn.example.com`.
10. Back up `/var/lib/campuslearn` regularly and test restoring a backup. Protect `.env` (`chmod 600 .env`).

## 5. Test on all device sizes

Use the same HTTPS deployment URL on:

- Android phone (Chrome)
- iPhone (Safari)
- iPad / Android tablet
- Windows laptop (Chrome or Edge)
- macOS laptop (Safari or Chrome)

Test the welcome page, each role sign-in, dashboard navigation, attendance/results, PDF preview/download, personal drive, assignment submission, quiz submission, and notifications. For file previews, use a real PDF/image and verify that downloads are not blocked by the browser's popup/download settings.

## 6. Gmail notifications

The existing notification helper emails the recipient when a notification is created. Assignment submission and quiz-attempt routes create a faculty notification, so faculty email delivery depends on correct SMTP configuration and the faculty account having a valid email address. Check service logs for `[Email] Sent` or `[Email] Failed` messages. In-app notifications still work if SMTP is not configured.

## 7. Moving existing data from a laptop

The ZIP contains application source, not your live `academic.db`, `uploads/`, or `private-drive/` data. To migrate an existing installation:

1. Stop the old application.
2. Copy `academic.db` and the complete `uploads/` and `private-drive/` folders to a secure backup location.
3. Stop the destination app before replacing its data.
4. Copy the database and both folders into the destination persistent volume's data directory (`/data` on Render/Railway, `/var/lib/campuslearn` on VPS host).
5. Preserve file permissions and restart the app.
6. Test one student account, one resource, and one private-drive file before switching everyone to the new URL.

Never send the database or private-drive files through a public Git repository. Keep an offline backup before each migration.

## 8. Common errors

- **Static CSS/JS or images return 404 after adding a volume:** confirm you are using this release's server code. Public frontend assets are served from the app release directory; only database and uploads belong under `DATA_DIR`.
- **Health check fails:** inspect logs, confirm `DATA_DIR` is writable, and check the database can open.
- **Admin credentials rejected:** the first admin is created only when the database is first initialized. Changing environment variables later does not reset an existing admin password. Use the project's admin reset procedure against the persistent database after making a backup.
- **Data disappears after redeploy:** the persistent volume is missing, not mounted at `/data`, or `DATA_DIR` differs from the mount path.
- **Gmail fails:** use a Google App Password and verify SMTP variables; do not use your Gmail account password.
- **A file is missing after moving hosts:** copy both `uploads/` and `private-drive/` along with the database.

## 9. Important limitations

This is a student-project deployment package, not a production-certified student information system. SQLite supports a single app instance well when placed on a persistent local disk. It is not the correct shared database for active multi-replica deployments. For high availability, concurrent multi-server use, and shared records across Render + Railway + VPS, migrate to PostgreSQL and shared object storage before enabling multiple live instances.
