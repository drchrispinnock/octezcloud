# Threat model

Octez Cloud is a static website. It generates a template that **you** deploy into
**your own** cloud account. This page sets out what we, the people who publish the
site and templates, can and cannot do.

## What we cannot do

- **Access your cloud account.** The site has no backend and never asks for
  credentials. Deploying happens in your cloud console, signed in as you.
- **See your consensus key.** It is generated inside a trusted execution environment
  (TEE) in your account and never leaves it unencrypted.
- **Move your funds.** Your manager key stays in your own wallet or Ledger. The cloud
  deployment never has it.

These hold **even if this website is compromised**. The worst a compromised site can
do is give you a link to a malicious template. That is why you should check what you
deploy (see below).

## What you trust

| Party | Trusted for | Not trusted for |
|---|---|---|
| You | Your cloud account, your manager key | — |
| Your cloud provider | TEE hardware, attestation, KMS | — (unavoidable) |
| This project | Publishing correct, open source templates and images | Holding credentials, keys or funds |
| The host VM | Running the node and baker, relaying traffic | Seeing the consensus key |

## The remaining risk: a malicious release

The main risk is that we publish a malicious template or signer image. To reduce it:

1. **Everything is open source**, and signer images are **reproducibly built**, so
   anyone can rebuild them and get the same measurement.
2. **Each release publishes** the SHA-256 of every template and the TEE image
   measurements, and signs them.
3. **The measurement is pinned in your own key policy.** The KMS key that seals your
   consensus key releases it only to the image measurement you deployed. We cannot
   change that policy. Only you can, by updating your stack.
4. **You can verify the attestation** your deployment produces, in your browser or
   with the CLI.

## Checking what you deploy

The configurator shows each template's URL, its published SHA-256 and a command to
check it yourself:

```sh
curl -fsSL '<template URL>' | shasum -a 256
```

Read the template before you click **Create stack**. The
[keys](keys.md) and [watermark](watermark.md) pages explain the parts that matter most.
