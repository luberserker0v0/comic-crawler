# Docker deployment

Run every command in this guide from the source-of-truth `repo/` directory.

## Build and start

Build the checked-out source and start ComicCrawler:

```bash
docker compose up -d --build app
```

The default host address is `http://127.0.0.1:4100`.
The container always listens on port `4100`.

Use another host port without changing the container port:

```bash
COMICCRAWLER_HOST_PORT=4200 docker compose up -d --build app
```

PowerShell:

```powershell
$env:COMICCRAWLER_HOST_PORT = "4200"
docker compose up -d --build app
```

## Update an existing deployment

After pulling or editing source, rebuild and replace only the application
container:

```bash
docker compose up -d --build --force-recreate app
```

This operation preserves both named volumes:

- `comic-data` stores configuration, credentials, tasks, and runtime state.
- `comic-downloads` stores downloaded comic files.

Do not run `docker compose down -v` unless the stored data should be deleted.

## Verify the deployment

Check the Compose service and Docker health status:

```bash
docker compose ps
docker inspect --format '{{.State.Health.Status}}' comiccrawler
```

Check the public status endpoint:

```bash
curl --fail http://127.0.0.1:4100/api/status
```

PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:4100/api/status
```

The Dockerfile contains the same `/api/status` health check as Compose, so a
container started without Compose still reports its health.

## Image name and metadata

Compose builds `luberserker/comiccrawler:latest` by default. Override the local
image name or tag when required:

```bash
COMICCRAWLER_IMAGE=comiccrawler \
COMICCRAWLER_IMAGE_TAG=refactor-test \
docker compose build app
```

Release builds can record a version and Git revision in OCI labels:

```bash
COMICCRAWLER_IMAGE_VERSION=0.2.0 \
COMICCRAWLER_IMAGE_REVISION=<git-commit> \
docker compose build app
```

Inspect the labels on the resulting image:

```bash
docker image inspect luberserker/comiccrawler:latest \
  --format '{{json .Config.Labels}}'
```

## Logs and resource limits

Follow recent application logs:

```bash
docker compose logs --tail=100 -f app
```

Compose uses Docker's `json-file` logging driver. Each log file is limited to
10 MB, and Docker retains three files. The default container limits are one CPU
and 1 GB of memory.

## Runtime boundary

The production image contains the backend, WebUI, documentation, AO bundle,
shared contracts, and Browser Client SDK runtime. It does not install or launch
Chromium.

Browser-backed tasks use an outbound connection from a user-side Browser Client.
The Browser Client controls the user's browser or selected tab and handles human
verification outside the ComicCrawler container.

## Stop or restart

Restart the application container:

```bash
docker compose restart app
```

Stop and remove the container while preserving volumes:

```bash
docker compose down
```
