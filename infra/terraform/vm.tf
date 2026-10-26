# One VM runs everything: Caddy (TLS, Let's Encrypt) in front of the game
# container, plus the Cloud SQL proxy when it is used. Games live in memory,
# so one stateful VM fits better than an autoscaled service. A Google load
# balancer would cost more than the VM; Caddy does the same job here.

resource "google_compute_address" "web" {
  name         = "${local.name}-web"
  region       = var.region
  network_tier = "STANDARD"
  depends_on   = [google_project_service.apis]
}

resource "google_compute_firewall" "web" {
  name          = "${local.name}-web"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["0.0.0.0/0"]
  target_tags   = [local.name]
  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }
  allow {
    protocol = "udp"
    ports    = ["443"]
  }
}

# SSH only through IAP. The deploy workflow uses this path.
resource "google_compute_firewall" "iap_ssh" {
  name          = "${local.name}-iap-ssh"
  network       = "default"
  direction     = "INGRESS"
  source_ranges = ["35.235.240.0/20"]
  target_tags   = [local.name]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

locals {
  # Plain (non-secret) server env. The VM writes it to /opt/landwar/app.env
  # on every deploy, so a change here needs only `terraform apply` and a deploy.
  app_env = merge({
    GAME_ENV          = "prod"
    DOMAIN            = var.domain
    PUBLIC_ORIGIN     = "https://${var.domain}"
    NUM_WORKERS       = tostring(var.num_workers)
    INSTANCE_LETTER   = "a"
    GOOGLE_CLIENT_ID  = var.google_client_id
    DISCORD_CLIENT_ID = var.discord_client_id
    # The master and each worker hold a pool of this size. db-f1-micro
    # allows 25 connections in all.
    DB_POOL_MAX = "5"
  }, var.extra_env)

  app_env_text = join("\n", [for k, v in local.app_env : "${k}=${v}"])
  secret_map   = join(" ", [for k, env in local.secret_env : "${env}=${google_secret_manager_secret.app[k].secret_id}"])
}

resource "google_compute_instance" "game" {
  name         = local.name
  machine_type = var.machine_type
  zone         = var.zone
  tags         = [local.name]

  allow_stopping_for_update = true

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = var.disk_size_gb
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip       = google_compute_address.web.address
      network_tier = "STANDARD"
    }
  }

  service_account {
    email  = google_service_account.vm.email
    scopes = ["cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = templatefile("${path.module}/../vm/startup.sh.tftpl", {
      compose_yaml = file("${path.module}/../vm/compose.yaml")
      caddyfile    = file("${path.module}/../vm/Caddyfile")
      deploy_sh    = file("${path.module}/../vm/deploy.sh")
    })
    landwar-env           = local.app_env_text
    landwar-secrets       = local.secret_map
    landwar-image         = local.image
    landwar-domain        = var.domain
    landwar-acme-email    = var.acme_email
    landwar-cloudsql      = local.cloudsql_connection
    landwar-registry-host = "${var.region}-docker.pkg.dev"
  }

  depends_on = [
    google_project_service.apis,
    google_secret_manager_secret_iam_member.vm,
  ]
}
