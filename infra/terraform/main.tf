locals {
  name      = "landwar"
  image     = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}/app"
  use_cloud = var.database == "cloudsql"
}

resource "google_project_service" "apis" {
  for_each = toset([
    "artifactregistry.googleapis.com",
    "compute.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "oslogin.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

# --- Image registry ---

resource "google_artifact_registry_repository" "app" {
  repository_id = local.name
  location      = var.region
  format        = "DOCKER"

  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "2592000s"
    }
  }

  depends_on = [google_project_service.apis]
}

# --- VM identity ---

resource "google_service_account" "vm" {
  account_id   = "${local.name}-vm"
  display_name = "LandWar game server VM"
}

resource "google_project_iam_member" "vm" {
  for_each = toset([
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
    "roles/cloudsql.client",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.vm.email}"
}

resource "google_artifact_registry_repository_iam_member" "vm_pull" {
  repository = google_artifact_registry_repository.app.name
  location   = var.region
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${google_service_account.vm.email}"
}

# --- Secrets ---
# Terraform state holds these values. Keep the state bucket private.

resource "random_password" "session_secret" {
  length  = 64
  special = false
}

locals {
  secrets = {
    "session-secret"       = random_password.session_secret.result
    "google-client-secret" = var.google_client_secret
    "database-url"         = local.use_cloud ? local.cloudsql_database_url : var.external_database_url
  }
  # Env var each secret becomes on the VM.
  secret_env = {
    "session-secret"       = "SESSION_SECRET"
    "google-client-secret" = "GOOGLE_CLIENT_SECRET"
    "database-url"         = "DATABASE_URL"
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  secret_id = "${local.name}-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret_iam_member" "vm" {
  for_each  = local.secrets
  secret_id = google_secret_manager_secret.app[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.vm.email}"
}

check "database_url_set" {
  assert {
    condition     = local.use_cloud || length(var.external_database_url) > 0
    error_message = "Set external_database_url, or set database = \"cloudsql\"."
  }
}
