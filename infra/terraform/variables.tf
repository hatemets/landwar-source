variable "project_id" {
  description = "GCP project id."
  type        = string
}

variable "region" {
  description = "Region for the VM, registry and database. europe-north1 is Finland."
  type        = string
  default     = "europe-north1"
}

variable "zone" {
  description = "Zone for the VM."
  type        = string
  default     = "europe-north1-a"
}

variable "domain" {
  description = "Public apex domain, e.g. landwar.example. Point its A record at the static_ip output."
  type        = string
}

variable "acme_email" {
  description = "Email for Let's Encrypt certificate notices."
  type        = string
}

variable "machine_type" {
  description = "VM type. e2-small (2 GB) fits 1-2 workers; use e2-medium (4 GB) for more."
  type        = string
  default     = "e2-small"
}

variable "num_workers" {
  description = "Game worker processes (NUM_WORKERS). Each needs about 300 MB."
  type        = number
  default     = 2
}

variable "disk_size_gb" {
  description = "Boot disk size."
  type        = number
  default     = 20
}

variable "database" {
  description = "\"external\": use external_database_url (Neon, Supabase). \"cloudsql\": create a Cloud SQL instance."
  type        = string
  default     = "external"

  validation {
    condition     = contains(["external", "cloudsql"], var.database)
    error_message = "database must be \"external\" or \"cloudsql\"."
  }
}

variable "external_database_url" {
  description = "Postgres URL when database = \"external\". Include ?sslmode=require."
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudsql_tier" {
  description = "Cloud SQL machine tier when database = \"cloudsql\"."
  type        = string
  default     = "db-f1-micro"
}

variable "google_client_id" {
  description = "Google OAuth client id. Redirect URI: https://<domain>/api/auth/google/callback"
  type        = string
}

variable "google_client_secret" {
  description = "Google OAuth client secret."
  type        = string
  sensitive   = true
}

variable "discord_client_id" {
  description = "Discord OAuth client id. Redirect URI: https://<domain>/api/auth/discord/callback. Empty turns Discord sign-in off."
  type        = string
  default     = ""
}

variable "discord_client_secret" {
  description = "Discord OAuth client secret."
  type        = string
  sensitive   = true
  default     = ""
}

variable "extra_env" {
  description = "Extra plain env vars for the server, e.g. { TURNSTILE_SITE_KEY = \"...\" }."
  type        = map(string)
  default     = {}
}

variable "github_repo" {
  description = "owner/name of the GitHub repo that may deploy."
  type        = string
  default     = "hatemets/landwar"
}

variable "github_deploy_ref" {
  description = "Git ref that may deploy."
  type        = string
  default     = "refs/heads/main"
}
