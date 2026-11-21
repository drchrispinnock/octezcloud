# Octez Cloud

A provisioning tool for AWS, GCP and Azure to set up a baker as securely as possible.
See [spec/SPEC.md](spec/SPEC.md).

## Layout

```
web/            Static site: configurator, verifier (M2), docs renderer
docs/           Markdown docs, rendered into the site (order in docs/nav.json)
skills/         Agent skills for users' AI assistants, published at /skills/
infra/site/     CloudFormation for hosting the site (S3 + CloudFront) and the release bucket
scripts/        deploy-site.sh
```

## Developing the site

```sh
cd web
npm ci
npm run dev        # http://127.0.0.1:8000, rebuilds on change
npm test && npm run typecheck
```

## Hosting the site on AWS

One stack holds the private site bucket, CloudFront (OAC, strict CSP/HSTS headers), the
public release bucket for CloudFormation templates, and optional GitHub OIDC roles.

```sh
# octezcloud.org: the stack creates the DNS-validated certificate and the apex + www records
# (www redirects to the apex). Must be us-east-1 because of the certificate.
AWS_PROFILE=home aws cloudformation deploy --region us-east-1 --stack-name octez-cloud-site \
  --template-file infra/site/site.yaml --capabilities CAPABILITY_IAM \
  --parameter-overrides DomainName=octezcloud.org HostedZoneId=Z05537052F6YEP5E948GC \
    GitHubRepository=drchrispinnock/octezcloud CreateGitHubOidcProvider=false

# Publish:
AWS_PROFILE=home AWS_REGION=us-east-1 scripts/deploy-site.sh octez-cloud-site
```

Without a custom domain, omit `DomainName`/`HostedZoneId` and the site is served on
`*.cloudfront.net`. To use an existing certificate, pass `CertificateArn` instead.
`SiteBucketName` is optional: visitors never see the bucket name, so the generated one is fine.
`CreateGitHubOidcProvider=false` because the account already has GitHub's OIDC provider.

The release bucket must be allowed a public bucket policy. If the account has S3 Block
Public Access turned on at account level, the stack fails at `ReleaseBucketPolicy`.

For CI, set the repository variables `AWS_REGION` and `AWS_SITE_DEPLOY_ROLE_ARN` (from the
`SiteDeployRoleArn` output). Pushes to `main` then deploy automatically.
