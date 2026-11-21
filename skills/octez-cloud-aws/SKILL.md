---
name: octez-cloud-aws
description: Deploy, check, upgrade and tear down an Octez Cloud Tezos baker (Octez node, DAL node, baker, Nitro Enclave signer) in the user's own AWS account, using the user's own AWS CLI and octez-client. Use when the user wants to set up baking on Tezos in AWS with Octez Cloud, verify an Octez Cloud release or attestation, check that their baker is healthy, upgrade the signer or Octez, rotate the consensus key, or remove a deployment.
---

# Octez Cloud on AWS

You are helping the user run a Tezos baker in **their own** AWS account. Octez Cloud
publishes CloudFormation templates and a Nitro Enclave signer image. You act only
through tools the user already has: the AWS CLI with their credentials, and
`octez-client` with their wallet.

> Status: the AWS template is milestone M1 and has not been released yet. If the release
> manifest has no release with status `testnet` or `stable`, say so and stop. Do not
> improvise a deployment by hand.

## Hard rules (never break these)

1. **Never ask for, read, print, store or pass on a secret key or seed phrase.** That
   includes the manager key, any `secret_keys` file and any mnemonic. If the user pastes
   one, tell them to treat it as compromised and to move their funds.
2. **The manager key stays with the user.** Commands that sign with it
   (`register key`, `set consensus key`, `stake`) run on the user's machine against their
   own wallet or Ledger. Show the command and let the user run it, or run it only after
   they confirm, so they approve on their own device.
3. **Never run two signers for the same consensus key at once.** That is how bakers get
   slashed. During an upgrade, migration or test, the old signer must be stopped and
   confirmed stopped before a new one starts.
4. **Never restore or edit the DynamoDB watermark table**, and never change its items.
5. **Verify before you deploy.** Check the template's SHA-256 against the release
   manifest. If they differ, stop and tell the user.
6. **Confirm before each change to AWS** (create/update/delete stack, change sets,
   key deletion). Show the exact command first.
7. **Mainnet needs explicit opt-in.** Use only networks the manifest lists as enabled.

## Inputs to collect

Ask only for what you cannot find out yourself:

- AWS profile and region (`aws configure list`, `aws sts get-caller-identity`)
- Network (from the manifest's enabled networks)
- Roles: node is always on. DAL node and baker default to on.
- Instance type: Graviton/arm64 by default (m7g.xlarge for testnets, m7g.2xlarge for mainnet),
  x86 (m6i) only if the user asks. Also the data volume size.
- Octez version: a full Debian version from the manifest, e.g. `25.3-1` (tzinit packages)
- The manager (delegate) address `tz1…`/`tz2…`/`tz3…`/`tz4…`. This is a public address, so it is safe to ask for.

## Workflow: deploy

1. **Read the release manifest** from the Octez Cloud site at `/releases.json`. Choose
   the newest `stable` or `testnet` release unless the user names one. Note
   `aws.template`, `aws.templateSha256` and `aws.enclave.<arch>.pcr0` for the instance's
   architecture (`arm64` for Graviton, `x86_64` otherwise).
2. **Pre-flight checks**
   ```sh
   aws sts get-caller-identity
   aws ec2 describe-instance-type-offerings --region "$REGION" \
     --filters Name=instance-type,Values="$INSTANCE_TYPE" --query 'InstanceTypeOfferings[].InstanceType'
   aws service-quotas get-service-quota --region "$REGION" \
     --service-code ec2 --quota-code L-1216C47A   # Running On-Demand Standard instances (vCPUs)
   ```
   The vCPU quota must cover the instance's vCPUs plus anything else already running.
3. **Verify the template**
   ```sh
   curl -fsSL "$TEMPLATE_URL" -o baker.yaml
   shasum -a 256 baker.yaml    # must equal aws.templateSha256
   ```
   Offer to summarise the resources and IAM permissions in `baker.yaml` before deploying.
4. **Create the stack** (after the user confirms)
   ```sh
   aws cloudformation create-stack --region "$REGION" --stack-name "$STACK" \
     --template-url "$TEMPLATE_URL" --capabilities CAPABILITY_IAM \
     --parameters ParameterKey=Network,ParameterValue="$NETWORK" \
                  ParameterKey=OctezVersion,ParameterValue="$OCTEZ_VERSION" \
                  ParameterKey=InstanceType,ParameterValue="$INSTANCE_TYPE" \
                  ParameterKey=DataVolumeSizeGiB,ParameterValue="$DISK_GIB" \
                  ParameterKey=EnableDalNode,ParameterValue=true \
                  ParameterKey=EnableBaker,ParameterValue=true
   aws cloudformation wait stack-create-complete --region "$REGION" --stack-name "$STACK"
   ```
   The configurator at `/configure/` on the site generates this same command.
5. **Read the outputs** (`aws cloudformation describe-stacks`). The signer publishes its
   tz4 consensus public key, proof of possession and attestation document. See
   *Stack interface* below.
6. **Verify the attestation**: the PCR0 in the document must equal the manifest's
   `aws.enclave.<arch>.pcr0`, and the public key must be bound to it. Use the Octez Cloud verifier CLI
   or the `/verify/` page.
7. **Hand over the wallet steps.** The user runs these on their own machine:
   ```sh
   octez-client register key <manager> as delegate          # only if not yet a delegate
   octez-client set consensus key for <manager> to <tz4 public key>
   octez-client stake <amount> for <manager>                # if needed
   ```
   Tell them the new consensus key becomes active only after the protocol's activation
   delay, and that the baker participates from then on.

## Workflow: health check

Use SSM Session Manager. The instance has no SSH.
```sh
aws ssm start-session --region "$REGION" --target "$INSTANCE_ID"
```
On the instance: `octez-client bootstrapped` (node synced), `systemctl status` for the
node, DAL node, baker and signer proxy services, and recent signer logs in CloudWatch
Logs. Report problems. Do not restart the signer unless the user asks.

## Workflow: upgrade

1. Read the new release's manifest entry and verify its template hash.
2. Create a **change set** and show the user what will change before running it.
3. During cutover the key policy allows **both** the old and new PCR0. The new signer
   starts only after the old one has stopped.
4. Once the new signer is healthy, run a second update that removes the old PCR0.

## Workflow: teardown

Do these in order, confirming each one:
1. Stop the baker.
2. Have the user rotate the consensus key away, or tell them they will miss rewards.
3. `aws cloudformation delete-stack`
4. Schedule deletion of the KMS key. This is irreversible after the waiting period, and the
   sealed consensus key cannot be recovered after it.

## Stack interface (v0, may change before the first release)

| Output | Meaning |
|---|---|
| `InstanceId` | Host EC2 instance, used for SSM sessions |
| `ConsensusPublicKeyParameter` | SSM parameter holding the tz4 public key |
| `AttestationParameter` | SSM parameter holding the base64 Nitro attestation document |
| `WatermarkTable` | DynamoDB watermark table. Read-only to you. Never write to it. |
| `KmsKeyArn` | Sealing key, whose policy pins PCR0 |
| `LogGroup` | CloudWatch Logs group for all services |
