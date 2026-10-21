output "static_ip" {
  description = "Point the domain's A record here."
  value       = google_compute_address.web.address
}

output "image" {
  description = "Image path the deploy workflow pushes to."
  value       = local.image
}

# Set these as GitHub repository variables (Settings > Secrets and variables > Actions > Variables).
output "github_variables" {
  value = {
    GCP_PROJECT_ID   = var.project_id
    GCP_ZONE         = var.zone
    GCP_VM_NAME      = google_compute_instance.game.name
    GCP_IMAGE        = local.image
    GCP_WIF_PROVIDER = google_iam_workload_identity_pool_provider.github.name
    GCP_DEPLOY_SA    = google_service_account.deployer.email
  }
}
