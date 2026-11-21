# Watermark and slashing

If a baker signs two different blocks or attestations for the same level and round, it
is **slashed**: part of its stake is burned. Signers prevent this with a *high
watermark*, the highest level and round they have signed for each kind of operation,
and they refuse to sign anything at or below it.

## Why this is harder inside a TEE

A TEE has no trusted persistent storage. If the watermark were kept on the host's disk,
a disk snapshot restore, or a malicious host replaying old state, could roll it back. A
restarted signer would then sign again at a level it had already signed, and you would
be slashed.

## How the signer handles it

- The watermark is stored **outside** the TEE, in a database that supports
  compare-and-swap writes (DynamoDB on AWS).
- Each record is authenticated with a key that exists only inside the TEE, so the host
  cannot forge or edit it.
- The signer advances the watermark **before** it returns a signature.
- On startup, the signer will not sign until it has read the latest watermark and
  confirmed it with a successful conditional write.
- The conditional write allows only one writer, so two signers cannot both advance
  the same watermark.

## Rules you must follow

1. **Never run two signers for the same key at once.** Not for testing, not for
   failover, and not "just for a minute" during an upgrade.
2. **When upgrading or migrating, stop the old signer before you start the new one.**
   The upgrade guide shows how.
3. **Do not restore the watermark table from a backup.**
4. If you are unsure what state a signer is in, leave it stopped and ask for help
   before starting anything.
