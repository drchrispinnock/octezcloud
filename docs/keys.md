# Keys explained

A baker deployed with Octez Cloud uses two separate keys, plus an optional third.

| Key | Where it lives | What it does | If you lose it |
|---|---|---|---|
| **Manager key** (your delegate) | Your own wallet or Ledger, **never** in the cloud | Registers the delegate, stakes, sets the consensus key | Critical. Keeping it safe is up to you. |
| **Consensus key** (tz4, BLS12-381) | Generated and used **only inside the TEE** | Signs blocks, attestations and preattestations | Recoverable: set a new consensus key from your manager key |
| **Companion key** (tz4, optional) | Inside the TEE, same as the consensus key | DAL attestations | Recoverable, same as the consensus key |

## Why losing a deployment costs only rewards

The consensus key can always be replaced from the manager key:

```sh
octez-client set consensus key for <manager> to <new tz4 public key>
```

If an instance is deleted or a KMS key is destroyed, you deploy again, set the new
consensus key and wait for it to activate. You miss rewards while that happens. You
never lose funds, because the deployment never had your manager key.

## Why a TEE and not cloud KMS

No major cloud KMS or HSM (AWS KMS, GCP Cloud KMS, Azure Key Vault, Managed HSM)
supports BLS12-381, so tz4 keys have to be signed in software. Running that software
in an attested TEE keeps the key away from the host VM and from anyone with access to
it. Cloud KMS is used only to **seal** the key: it releases the wrapping key to the TEE
only after checking the TEE's attestation.

## Lifecycle

1. On first boot the TEE generates the key from hardware-seeded randomness.
2. It asks KMS for the wrapping key, proving its identity with an attestation document,
   encrypts the private key and stores the ciphertext on the host.
3. It publishes the public key, a proof of possession and the attestation document.
4. On later boots it attests again, unwraps the key and resumes signing.
