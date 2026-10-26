# GitHub Actions signs in with Workload Identity Federation: no key files.
# Only var.github_repo on var.github_deploy_ref may use the deployer account.

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }
  # job_workflow_ref pins the token to deploy.yml, so no other workflow in the
  # repo (or a reusable one it calls) can act as the deployer.
  attribute_condition = "assertion.repository == \"${var.github_repo}\" && assertion.ref == \"${var.github_deploy_ref}\" && assertion.job_workflow_ref == \"${var.github_repo}/.github/workflows/deploy.yml@${var.github_deploy_ref}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  account_id   = "${local.name}-deployer"
  display_name = "LandWar GitHub deployer"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  repository = google_artifact_registry_repository.app.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deployer.email}"
}

# SSH to the VM through IAP with sudo, to run /opt/landwar/deploy.sh.
resource "google_project_iam_member" "deployer" {
  for_each = toset([
    "roles/compute.viewer",
    "roles/compute.osAdminLogin",
    "roles/iap.tunnelResourceAccessor",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# OS Login for a service account also needs to act as the VM's account.
resource "google_service_account_iam_member" "deployer_as_vm" {
  service_account_id = google_service_account.vm.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
