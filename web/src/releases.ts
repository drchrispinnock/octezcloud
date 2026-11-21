// Release manifest. Each signer/template release is listed here with the
// SHA-256 of every template and the TEE measurements it was built with.
// The manifest is bundled into the site at build time (no runtime fetch), so
// the configurator and verifier work from exactly what was reviewed and deployed.

import manifest from "../releases.json" with { type: "json" };

export type Cloud = "aws" | "gcp" | "azure";

export interface NetworkInfo {
  id: string;
  label: string;
  /** Networks that are listed but cannot be selected yet (e.g. mainnet before audit). */
  disabledReason?: string;
}

export interface AwsArtifacts {
  /** Path of the CloudFormation template, relative to the release prefix. */
  template: string;
  templateSha256: string;
  /** Nitro Enclave image measurements (hex, SHA-384), per CPU architecture:
   *  the enclave image is built separately for arm64 and x86_64. */
  enclave: Partial<Record<"arm64" | "x86_64", { pcr0: string; pcr1?: string; pcr2?: string }>>;
}

export interface Release {
  version: string;
  status: "unreleased" | "testnet" | "stable" | "deprecated";
  date?: string;
  /** Octez versions that this release's templates can pin. First is the default. */
  octezVersions: string[];
  networks: NetworkInfo[];
  sourceUrl: string;
  aws?: AwsArtifacts;
}

export interface Manifest {
  releases: Release[];
}

export const MANIFEST = manifest as Manifest;

/** Base URL of the public release bucket, injected at build time. */
declare const __RELEASES_BASE_URL__: string;
export const RELEASES_BASE_URL: string =
  typeof __RELEASES_BASE_URL__ === "string" ? __RELEASES_BASE_URL__ : "";

export function isDeployable(r: Release): boolean {
  return r.status === "testnet" || r.status === "stable";
}

export function templateUrl(base: string, release: Release, path: string): string {
  return `${base.replace(/\/+$/, "")}/${encodeURIComponent(release.version)}/${path}`;
}
