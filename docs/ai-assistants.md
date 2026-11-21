# Using an AI assistant

Octez Cloud publishes **agent skills**, instructions that AI coding assistants such as
Claude Code can load to deploy, check, upgrade and remove a baker for you.

The assistant works only through tools you already have: your AWS CLI, signed in as
you, and your own `octez-client`. The website is still not involved, and the trust
model is the same as deploying by hand (see the [threat model](threat-model.md)).

## Available skills

| Skill | What it covers |
|---|---|
| [`octez-cloud-aws`](/skills/octez-cloud-aws/SKILL.md) | Deploy, health check, upgrade and teardown on AWS |

Assistants can also read the release manifest at [`/releases.json`](/releases.json).

## Installing (Claude Code)

```sh
mkdir -p ~/.claude/skills/octez-cloud-aws
curl -fsSL https://<this site>/skills/octez-cloud-aws/SKILL.md \
  -o ~/.claude/skills/octez-cloud-aws/SKILL.md
```

Read the file before you install it. It is short, and it is what your assistant will follow.

## What the skill will never do

- Ask for, read or handle your manager key, secret keys or seed phrase.
- Sign anything with your manager key without you approving it on your own device.
- Start a second signer for the same key, or touch the watermark table
  (see [watermark and slashing](watermark.md)).
- Change your AWS account without showing you the command and getting your confirmation.
