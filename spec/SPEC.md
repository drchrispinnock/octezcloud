# Confidential Tezos Baker Provisioning — Specification

Status: Draft v0.1 (2026-11-21)

## 1. Summary

A website that lets people deploy a Tezos node, DAL node and baker into **their own**
AWS, GCP or Azure account, with the baker's consensus key generated and used only inside
a hardware-backed trusted execution environment (TEE):

- **AWS:** Nitro Enclaves
- **GCP:** Confidential Space / Confidential VM
- **Azure:** Confidential Containers on ACI / Confidential VM

The website is a **static configuration generator, documentation site and attestation
verifier**. It never holds cloud credentials, never sees private keys and never moves funds.
The user deploys the generated template themselves, using each cloud's one-click deploy flow.

## 2. Goals and non-goals

### Goals
- G1. A non-expert can go from zero to baking on a public Tezos network
  (mainnet, shadownet, bakingnet) by following the docs and clicking through.
- G2. The consensus private key never exists outside an attested TEE running a
  published, reproducibly built image.
- G3. The website operator cannot access the user's cloud account, keys or funds,
  even if the website itself is compromised.
- G4. The same signer core runs on all three clouds, with a thin adapter per cloud.
- G5. Users can review exactly what will be deployed before deploying it.

### Non-goals (v1)
- Managing or monitoring deployments from the website (no credentials, no backend).
- Custody of the manager key or any funds.
- Ongoing operations (upgrades, rotation) beyond documented, user-run procedures.

## 3. Trust model

| Party | Trusted for | Not trusted for |
|---|---|---|
| User | Their cloud account, their manager key/wallet | — |
| Cloud provider | TEE hardware, attestation services, KMS | — (inherent) |
| Website / project | Publishing correct, open source templates and images | Holding credentials, keys or funds |
| Host VM (parent instance) | Running node and baker, relaying traffic | Seeing the consensus key |

The main remaining risk is that **we publish a malicious template or image**.
Mitigations:
- All source code is open, and enclave/container images are **reproducibly built**.
- Each release publishes its image measurements (PCRs, image digest, CCE policy hash)
  and the SHA-256 of each template, and signs them.
- The image measurement is pinned in the **user's own** KMS/Key Vault release policy at
  deploy time. Changing it requires the user to update their stack.
- The browser-based verifier lets users check attestation themselves (§8).

## 4. Key architecture

Two separate keys:

| Key | Location | Purpose | Loss impact |
|---|---|---|---|
| **Manager key** (delegate) | User's own wallet / Ledger, never in the cloud | Registers the delegate, stakes, sets the consensus key | Critical: the user's responsibility |
| **Consensus key** (tz4, BLS12-381) | Generated and used **only inside the TEE** | Signs blocks, attestations and preattestations | Recoverable: rotate it with `octez-client set consensus key` |

Because the consensus key can be rotated from the manager key, losing a deployment
(instance deleted, KMS key destroyed) costs only missed rewards during recovery, never funds.

Also consider a separate tz4 **companion key** for DAL, held in the TEE by the same mechanism.

### Why a TEE and not cloud KMS/HSM
None of AWS KMS, GCP Cloud KMS, Azure Key Vault or Managed HSM supports BLS12-381.
tz4 keys must be signed in software, so the software must run in an attested TEE.
Cloud KMS is used only to **seal** the BLS key (wrapping key released on attestation).

## 5. Deployment architecture

```
User's cloud account
┌──────────────────────────────────────────────────────────────┐
│ Private network (only P2P port 9732 open to the internet)    │
│                                                              │
│  Host VM                                                     │
│   ├─ octez-node        (RPC bound to localhost)              │
│   ├─ octez-dal-node                                          │
│   ├─ octez-baker  ── signing requests ──┐                    │
│   └─ vsock / private-network proxy      │                    │
│                                         ▼                    │
│  TEE signer (enclave / Confidential Space / ACI CC)          │
│   - generates consensus key inside the TEE                   │
│   - seals it with a wrapping key released only on attestation│
│   - enforces the high watermark (§7)                         │
│   - exposes the Tezos remote signer protocol                 │
│                                                              │
│  KMS / Key Vault key, release policy pinned to image hash    │
│  Sealed key blob + watermark store                           │
│  Logs → user's CloudWatch / Cloud Logging / Log Analytics    │
└──────────────────────────────────────────────────────────────┘
```

### Common requirements for every cloud
- No SSH. Access goes through SSM Session Manager, IAP or Azure Bastion.
- Encrypted disks.
- Node RPC is not exposed publicly.
- The host role/identity has only the permissions it needs.
- Everything is tagged `managed-by=<project>` with the release version.
- Host OS is Debian 13 (trixie), amd64 or arm64.
- Octez is installed from the Tezos Foundation Debian packages (apt.tzinit.org, see
  packages.tzinit.org), with the version pinned in the template (§5.1).

### 5.1 Octez packages
- Repository setup uses **extrepo**, so no key is fetched over the network:
  ```sh
  apt-get install -y extrepo
  extrepo enable tzinit
  apt-get update
  ```
  The tzinit key and sources definition come from Debian's own `extrepo` data. Trust is
  therefore anchored in the Debian archive signature the host already trusts, not in a key
  downloaded from apt.tzinit.org.
- As defence in depth, the template checks after `extrepo enable` that the installed tzinit key
  has fingerprint `181E 6294 A077 0AE9 AF01 73B2 1F68 8E12 01D8 19B4` (ed25519,
  "Tzinit Repository Key"). It stops if not, so a change of key is noticed and reviewed in a release.
- Resulting repository: `https://apt.tzinit.org/debian trixie main` (Release file: Origin `Tzinit`,
  architectures amd64 and arm64).
- Packages: `octez-node`, `octez-dal-node`, `octez-baker`, `octez-client`. Also `octez-signer`
  for reference: the TEE signer is our own image, not this package.
- Version pinning: the template's `OctezVersion` parameter is the full Debian version
  (e.g. `25.3-1`), installed as `apt-get install octez-node=25.3-1 ...` and held with
  `apt-mark hold`, so unattended upgrades never move Octez. Upgrades go through a stack update (§10).
- Other channels exist (`/DEVEL/debian` for development builds, `/BLSTPORTABLE/debian` for older
  CPUs with BLS problems). Releases use only the default channel.

## 6. Per-cloud implementation

| | AWS | GCP | Azure |
|---|---|---|---|
| Deploy flow | CloudFormation **Launch Stack** quick-create link | **Open in Cloud Shell** (Terraform, tagged git release) or Infrastructure Manager | **Deploy to Azure** button (Bicep/ARM template from a URL), or Terraform in Cloud Shell |
| Host | EC2 with Nitro Enclaves enabled. Graviton (m7g/m6g/r7g, arm64) by default, x86 (m6i/m7i) optional | Confidential VM (SEV-SNP / TDX) | Confidential VM (DCasv5/ECasv5 SEV-SNP, DCesv6 TDX) or standard VM |
| Signer TEE | Nitro Enclave (EIF image) | Confidential Space workload (container) | Confidential Container on ACI (SEV-SNP) |
| Host to signer transport | vsock | Private VPC network | Private VNet subnet |
| Attestation | Nitro attestation document (COSE, AWS Nitro root CA) | Confidential Space OIDC attestation token | Microsoft Azure Attestation (MAA) token |
| Measurement pinned | PCR0 (image), optionally PCR1/2/8 | Container image digest (+ support/debug claims) | CCE policy hash (`x-ms-sevsnpvm-hostdata`) |
| Key release | KMS key policy condition `kms:RecipientAttestation:ImageSha384` / PCRs | Workload Identity Pool attribute conditions, then Cloud KMS decrypt | Key Vault Premium **Secure Key Release** policy (Managed HSM optional) |
| Public key / attestation output | SSM Parameter | GCE guest attributes / Secret Manager | Key Vault secret / container group output |

### 6.1 AWS notes
- The enclave has no network or disk. The parent instance runs a vsock proxy to KMS
  (`kmstool` / vsock-proxy pattern) and to the baker.
- Debug-mode enclaves produce zeroed PCRs. The KMS policy must not allow them.

### 6.2 GCP notes
- The Confidential Space image runs a container only if its attestation token meets the
  WIP conditions (image digest, `support_attributes` includes `STABLE`, no debug).
- The node and baker can run on a normal VM or a Confidential VM next to the workload.

### 6.3 Azure notes
- ACI confidential containers are preferred over a Confidential VM for the signer.
  The CCE policy hash binds the key to an exact image and configuration. CVM attestation
  proves only the hardware platform unless you rely on vTPM measured-boot claims.
- SKR releases an RSA-HSM wrapping key into the attested container. That key unwraps
  the sealed BLS key.
- Use Key Vault Premium by default. Managed HSM costs a lot more and is optional.
- Confidential SKUs are available in limited regions and often need a quota increase,
  so the quickstart includes a pre-flight check.

## 7. Signer

### 7.0 Implementation: Signatory + tee-signer (forked)
The signer is built from two existing Apache-2.0 projects, forked so we can carry the
changes below and pin our own releases:

| Component | Upstream | Fork | Runs on | Role |
|---|---|---|---|---|
| Signatory (Go) | `ecadlabs/signatory` (v1.4.1) | `drchrispinnock/signatory` | Host VM | Octez remote signer protocol to the baker, request decoding and policy, KMS vsock proxy, encrypted-key and watermark storage |
| tee-signer (Rust) | `signatory-io/tee-signer` | `drchrispinnock/tee-signer` | Nitro Enclave / Confidential Space | Key generation, KMS-attested sealing and unsealing, signing (BLS with proof of possession, Ed25519, secp256k1, P-256) |

Upstream already provides: enclave-side key generation, KMS sealing pinned to PCR0, tz4 BLS
with PoP, a vsock transport (Nitro) and TCP (Confidential Space), and a DynamoDB/Firestore
watermark in Signatory.

**Gap that the forks close:** upstream enforces policy and the high watermark only in Signatory
on the host. tee-signer's `Sign`/`SignWith` RPCs sign any bytes they are given. So a
compromised host could get the enclave to double-sign. That breaks §7.3, which requires the TEE
itself to refuse. The forks add an **enclave-enforced consensus mode** (§7.3.1). Upstream caveats
that we take on: tee-signer's TEE backends are beta, there are no published EIFs/PCRs or
reproducible builds, arm64 is undocumented, and ECAD Labs has wound down active Tezos protocol
maintenance (v1.4.1 was validated up to PtTALLiN).

We aim to offer the enclave changes upstream, but releases build from our forks.

### 7.1 Interface
- Implements the Octez remote signer protocol (TCP or Unix socket as seen by the baker),
  so `octez-baker` uses it unchanged.
- Allows only consensus operations (block, preattestation, attestation, DAL attestation)
  for the configured key. Refuses everything else (transfers, etc.).
- Checks the chain ID against the configured network.

### 7.2 Key lifecycle
1. First boot: the TEE generates the BLS key from hardware-seeded randomness.
2. The TEE fetches the wrapping key from KMS using its attestation, encrypts the private
   key, and writes the ciphertext to host storage.
3. The TEE publishes the public key, a proof of possession and the attestation document.
4. Later boots: the TEE re-attests, unwraps the key and resumes.

### 7.3 High watermark / anti-rollback (critical)
TEEs have no trusted persistent storage. If watermark state can be rolled back
(snapshot restore, a malicious host replaying old state), a restarted signer could
double-sign and the baker would be **slashed**.

Requirements:
- The watermark (level, round per operation kind) is stored outside the TEE in a store
  with **conditional (compare-and-swap) writes**:
  DynamoDB (AWS), Firestore (GCP), Cosmos DB or Table Storage with ETags (Azure).
- Each record is MAC'd or signed with a key derived inside the TEE, so the host
  cannot forge it.
- The signer increases the watermark **before** returning a signature.
- On startup, the signer refuses to sign until it has read the latest watermark and
  confirmed it with a successful conditional write.
- When migrating or upgrading, the docs require stopping the old signer before starting
  the new one. The conditional write enforces a single writer.

Open question: whether to also add a small "safety margin" (e.g. skip N levels after a
restart with unclear state).

#### 7.3.1 Enclave-enforced consensus mode (tee-signer fork)
- A per-key policy is fixed at key generation and sealed with the key: *consensus only*, plus
  the chain ID. The host cannot change it. Changing it means generating a new key.
- For such keys the enclave rejects the raw `Sign`/`SignDigest`/`SignWith` paths. It accepts
  only Tenderbake block, preattestation and attestation payloads (and DAL attestations if the
  key is a companion key). It parses the magic byte, chain ID, level and round itself.
- The enclave holds the watermark (per operation kind: level, round, and payload hash so an
  identical re-sign is allowed). It refuses anything at or below the watermark unless it is the
  identical payload.
- Persistence: before returning a signature the enclave emits the new watermark record, MAC'd
  with a key derived inside the enclave from the sealed key material. Signatory must write it to
  DynamoDB with a conditional (version-checked) write and confirm success. Only then does the
  enclave release the signature. This is a two-step `SignConsensus` → `CommitWatermark` RPC.
- On startup the enclave refuses to sign until Signatory has fed it the latest record, the
  enclave has verified its MAC, and a conditional write of a fresh record (with a new epoch) has
  succeeded. A stale or forged record means no signing.
- Signatory's existing host-side watermark stays as a second, independent check.

### 7.4 Images
- One signer codebase (the two forks in §7.0), with cloud adapters for attestation, key release
  and watermark store.
- The enclave image (EIF) is built from the tee-signer fork with a pinned Rust toolchain, for
  aarch64 (Graviton, default) and x86_64. The Signatory host binary is built from its fork and
  installed on the host. Its version is pinned in the template alongside Octez.
- Reproducible builds: Nix or pinned Docker with `SOURCE_DATE_EPOCH`, published from CI with
  provenance (SLSA/Sigstore).
- Each release publishes AWS PCRs (one set per architecture: the EIF is built for both arm64
  and x86_64), the GCP image digest and the Azure CCE policy hash.

## 8. Website

Static site: no backend, no accounts, no analytics that see wallet or key data.

### 8.1 Configurator
Inputs: cloud, network, roles (node / DAL / baker), region, instance size, Octez version,
signer release.
Outputs:
- A deploy link or button with parameters prefilled (template URL pinned to the release).
- The template SHA-256 and a link to its source.
- An estimated monthly cost.

### 8.2 Attestation verifier (runs in the browser)
- Input: the attestation document/token and public key that the deployment outputs.
- Checks:
  1. The certificate chain or token signature against the cloud's root (Nitro root CA,
     Google Confidential Space JWKS, MAA signing keys).
  2. The measurement matches a published, signed release.
  3. The public key is bound to the attestation (in `user_data` / nonce / runtime claims).
  4. Debug mode is off.
- A CLI with the same checks is published for offline verification.

### 8.3 Post-deploy guide
Exact commands for the user to run from their own wallet:
- Register as delegate (if new)
- `octez-client set consensus key for <manager> to <tz4 pk>`
- Stake
- How to tell the node is synced and the baker is participating

## 9. Documentation set

| Page | Contents |
|---|---|
| Quickstart: AWS / GCP / Azure | Click-through with screenshots, pre-flight checks (quotas, regions), post-deploy commands |
| What the template does | Each resource and permission, section by section, so users can review before deploying |
| Threat model | §3 in plain language: what we can and cannot do |
| Verifying attestation | Browser verifier, CLI, reproducing the build yourself |
| Keys explained | Manager vs consensus vs companion key, and why loss is recoverable |
| Watermark and slashing | §7.3 and safe operating rules (never run two signers) |
| Upgrading | Stack update / changeset review, allowing old and new measurements during cutover, removing the old one afterwards |
| Rotating the consensus key | Steps, plus waiting for the protocol activation delay |
| Teardown | Order: stop baker → rotate/unset consensus key → delete stack → schedule key deletion |
| Costs | Per cloud and instance size |
| Troubleshooting | Sync, attestation failures, quota, KMS/SKR denials |

## 10. Upgrades

1. A new release publishes new measurements.
2. The user updates their stack. The key release policy now allows **both** old and new
   measurements.
3. The new signer starts only after the old one stops (enforced by the watermark CAS).
   It unwraps the key using the same wrapping key.
4. Once the new signer is healthy, the user runs a second update to remove the old
   measurement.

Octez upgrades for protocol changes follow the same stack-update path. The docs track
each protocol activation.

## 11. Roadmap

1. **M1: AWS end to end.** tee-signer fork with the enclave-enforced consensus mode (§7.3.1),
   reproducible arm64/x86_64 EIFs with published PCRs, Signatory fork wired to it, CloudFormation
   template, watermark on DynamoDB, CLI verifier, AWS quickstart. Target network: bakingnet/shadownet.
2. **M2: Website.** Configurator, browser verifier, documentation set.
3. **M3: Azure.** ACI confidential container adapter, MAA + SKR, Bicep template.
4. **M4: GCP.** Confidential Space adapter, WIF + Cloud KMS, Terraform module.
5. **M5: Mainnet readiness.** External security audit, reproducible-build verification
   by third parties, chaos testing of the watermark (restarts, rollbacks, split brain).
6. **Later (optional):** monitoring that users opt into (read-only role or metrics they
   push themselves), DAL companion key, multi-region failover.

## 12. Proposed repository layout

```
(signer)           Separate repos: drchrispinnock/tee-signer (enclave) and
                   drchrispinnock/signatory (host), both forked from upstream, see §7.0
/images            Reproducible TEE image builds (pin fork commits, build EIFs, emit PCRs)
/templates/aws     CloudFormation
/templates/gcp     Terraform module
/templates/azure   Bicep
/verifier          Shared attestation verification (compiled for browser and CLI)
/web               Static site: configurator, verifier UI, docs
/docs              Markdown source for the documentation set
/skills            Agent skills so users' AI assistants can deploy and operate via the user's own CLI
/infra/site        Hosting for the website itself (S3 + CloudFront) and the public release bucket
```

## 13. Open questions

- ~~Implementation language / reuse Signatory?~~ Decided (2026-11-21): fork Signatory (Go, host)
  and tee-signer (Rust, enclave). See §7.0. The verifier stays Rust/WASM.
- How tee-signer authenticates its vsock client, and whether to add mutual authentication
  between Signatory and the enclave (defence in depth beyond §7.3.1).
- Azure: tee-signer has no ACI confidential-container backend yet. M3 means adding one to the fork.
- Watermark safety margin after an unclean restart (§7.3).
- Whether to support a non-TEE "testnet only" mode for cheaper experimentation.
- Release signing and key management for the project itself.
