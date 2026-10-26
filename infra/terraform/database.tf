# Cloud SQL, only when var.database = "cloudsql". The VM reaches it through
# the Cloud SQL Auth Proxy container (infra/vm/compose.yaml) over the VPC, so
# the instance has a private IP only.

resource "random_password" "db" {
  count   = local.use_cloud ? 1 : 0
  length  = 32
  special = false
}

data "google_compute_network" "default" {
  name = "default"
}

resource "google_compute_global_address" "sql_peering" {
  count         = local.use_cloud ? 1 : 0
  name          = "${local.name}-sql-peering"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 20
  network       = data.google_compute_network.default.id
  depends_on    = [google_project_service.apis]
}

resource "google_service_networking_connection" "sql" {
  count                   = local.use_cloud ? 1 : 0
  network                 = data.google_compute_network.default.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.sql_peering[0].name]
}

resource "google_sql_database_instance" "main" {
  count            = local.use_cloud ? 1 : 0
  name             = "${local.name}-pg"
  database_version = "POSTGRES_17"
  region           = var.region

  deletion_protection = true

  settings {
    tier              = var.cloudsql_tier
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled    = false
      private_network = data.google_compute_network.default.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "03:00"
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day  = 1
      hour = 4
    }
  }

  depends_on = [google_service_networking_connection.sql]
}

resource "google_sql_database" "main" {
  count    = local.use_cloud ? 1 : 0
  name     = local.name
  instance = google_sql_database_instance.main[0].name
}

resource "google_sql_user" "main" {
  count    = local.use_cloud ? 1 : 0
  name     = local.name
  instance = google_sql_database_instance.main[0].name
  password = random_password.db[0].result
}

locals {
  cloudsql_connection = local.use_cloud ? google_sql_database_instance.main[0].connection_name : ""
  # The proxy encrypts the hop to Cloud SQL; the hop to the proxy stays on
  # the VM's Docker network.
  cloudsql_database_url = local.use_cloud ? "postgres://${local.name}:${random_password.db[0].result}@cloudsql-proxy:5432/${local.name}?sslmode=disable" : ""
}
