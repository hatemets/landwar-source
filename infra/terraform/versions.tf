terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State lives in a GCS bucket. Create the bucket once by hand (see
  # docs/Deploy.md), then: terraform init -backend-config="bucket=<name>"
  backend "gcs" {
    prefix = "landwar"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  zone    = var.zone
}
