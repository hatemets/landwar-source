# Deploy to Google Cloud

Production is one Compute Engine VM. It runs three containers from `infra/vm/compose.yaml`:

- **caddy**: TLS with automatic Let's Encrypt certificates, on ports 80 and 443.
- **app**: the LandWar image (nginx, master, `NUM_WORKERS` game workers).
- **cloudsql-proxy**: only when `database = "cloudsql"`.

Games live in memory, so one stateful VM fits better than Cloud Run or a managed instance group. Caddy replaces a Google load balancer, which costs more than the VM.

Terraform (`infra/terraform/`) creates the VM, a static IP, firewall rules, Artifact Registry, Secret Manager secrets, optional Cloud SQL, and the GitHub deploy identity. `.github/workflows/deploy.yml` builds and deploys each green commit on `main`.

## Cost

Rough monthly prices in `europe-north1`. Check the GCP pricing pages before you commit.

| Item                                  | USD / month |
| ------------------------------------- | ----------- |
| VM `e2-small` (2 vCPU shared, 2 GB)   | about 14    |
| 20 GB balanced disk                   | about 2     |
| Static IPv4, in use                   | about 4     |
| Artifact Registry, Secret Manager     | under 1     |
| Network egress (Standard tier)        | by usage    |
| **Database: Neon free tier**          | 0           |
| **Database: Cloud SQL `db-f1-micro`** | about 10    |

Database choice:

- **Neon** (recommended to start): free tier, Postgres 17, no pause penalty beyond a short cold start. Set `database = "external"` and `external_database_url`.
- **Supabase**: the free tier pauses a project after a week without traffic, and Pro is 25 USD a month. Use its session pooler URL. Its certificate is signed by Supabase's own CA, so add `&uselibpqcompat=true` with `sslmode=require`, or `pg` refuses the connection.
- **Cloud SQL**: everything stays in GCP, with daily backups and point-in-time recovery. Set `database = "cloudsql"`.

## First setup

1. Create a GCP project with billing on.
2. In the console, create a private GCS bucket for Terraform state, e.g. `<project>-tfstate`. Turn on object versioning.
3. Create a Google OAuth client (APIs & Services > Credentials > OAuth client ID, type Web). Add the redirect URI `https://<domain>/api/auth/google/callback`.
4. If you use Neon, create a project and a database named `landwar`. Copy the connection URL with `?sslmode=require`.
5. Copy `infra/terraform/terraform.tfvars.example` to `terraform.tfvars` and fill it in. The file is git-ignored.
6. Apply:

   ```bash
   cd infra/terraform
   terraform init -backend-config="bucket=<project>-tfstate"
   terraform apply
   ```

7. Point the domain's A record at the `static_ip` output. Caddy gets the certificate when the first request arrives.
8. In GitHub, create the environment `production` (Settings > Environments). Add each `github_variables` output as a repository variable.
9. Create the public source repository and its deploy key (see [Source code](#source-code)).
10. Run the **🚀 Deploy** workflow by hand, or push to `main`.

The master applies database migrations when it starts.

## Day to day

- **Deploy**: merge to `main`. CI runs, then the deploy workflow. A deploy restarts the app container, which ends games in progress. Deploy when few players are online.
- **Config change**: edit `terraform.tfvars` (or `extra_env`) and run `terraform apply`. The VM reads the new values at the next deploy. Re-run the workflow to apply them now.
- **Rotate a secret**: change the variable and apply. The session secret is random; `terraform apply -replace=random_password.session_secret` rotates it and signs everyone out.
- **Logs**: Cloud Logging, resource "VM Instance", log name `gcplogs-docker-driver`.
- **Shell**: `gcloud compute ssh landwar --zone <zone> --tunnel-through-iap`. Files are in `/opt/landwar`.
- **Roll back**: run `sudo /opt/landwar/deploy.sh <older-commit-sha>` on the VM. Artifact Registry keeps the last 10 images.

## Server environment

Terraform writes these into the instance metadata and Secret Manager. `infra/vm/deploy.sh` turns them into `/opt/landwar/app.env`.

| Variable               | Source             | Notes                                                               |
| ---------------------- | ------------------ | ------------------------------------------------------------------- |
| `GAME_ENV`             | fixed `prod`       |                                                                     |
| `DOMAIN`               | `domain`           | Apex domain.                                                        |
| `PUBLIC_ORIGIN`        | `https://<domain>` | Google redirects back here.                                         |
| `NUM_WORKERS`          | `num_workers`      | About 300 MB each.                                                  |
| `INSTANCE_LETTER`      | fixed `a`          | First letter of every game id.                                      |
| `GOOGLE_CLIENT_ID`     | variable           |                                                                     |
| `GOOGLE_CLIENT_SECRET` | secret             |                                                                     |
| `SESSION_SECRET`       | secret, random     | Signs session cookies and join tokens.                              |
| `DATABASE_URL`         | secret             | Built for Cloud SQL, or `external_database_url`.                    |
| `GIT_COMMIT`           | image build arg    | Set by the workflow.                                                |
| `DB_POOL_MAX`          | fixed `5`          | Per process. Keep `5 * (NUM_WORKERS + 1)` under the database limit. |
| others                 | `extra_env`        | Optional values, e.g. `ADMIN_BOT_API_KEY`.                          |

## Source code

AGPL-3.0 requires that players can get the source of the build they play. This repository stays private. Before each deploy, the workflow runs `scripts/publish-source.sh`, which pushes one snapshot commit to the public repository https://github.com/hatemets/landwar-source and tags it `build-<commit>`. The main menu links that tag (`sourceCodeUrl` in `src/client/GameVersion.ts`).

- The snapshot leaves out the files in the script's `EXCLUDE` list. Add private notes there, or keep them out of git.
- Actions are off in the public repository, so its copy of the workflows never runs.
- The workflow pushes with the secret `SOURCE_DEPLOY_KEY`, an SSH key that is a write deploy key on the public repository. To replace it:

  ```bash
  ssh-keygen -t ed25519 -N "" -f key
  gh repo deploy-key add key.pub -R hatemets/landwar-source --allow-write --title "landwar deploy workflow"
  gh secret set SOURCE_DEPLOY_KEY -R hatemets/landwar < key
  rm key key.pub
  ```

- A rollback (`deploy.sh <older-commit-sha>`) needs no new snapshot: that build was published when it was first deployed.
