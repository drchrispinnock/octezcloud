#!/usr/bin/env bash
# Build the website and publish it to the S3 bucket / CloudFront distribution
# created by infra/site/site.yaml.
#
#   scripts/deploy-site.sh [stack-name]        (default: octez-cloud-site)
#
# Uses whatever AWS credentials are active (AWS_PROFILE, SSO, or GitHub OIDC in CI).
# Set AWS_REGION to the region the site stack lives in.
set -euo pipefail

STACK="${1:-octez-cloud-site}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output SiteBucketName)"
DIST_ID="$(output DistributionId)"
RELEASES_BASE_URL="$(output ReleasesBaseUrl)"
SITE_URL="$(output SiteUrl)"
[[ -n "$BUCKET" && "$BUCKET" != "None" ]] || { echo "stack $STACK has no SiteBucketName output" >&2; exit 1; }

echo "Building site (releases: $RELEASES_BASE_URL)"
(cd "$ROOT/web" && npm ci --no-audit --no-fund && npm test && RELEASES_BASE_URL="$RELEASES_BASE_URL" npm run build)

OUT="$ROOT/web/dist"

# Fingerprinted assets: cache forever. Upload first so new HTML never points at missing files.
aws s3 sync "$OUT/assets" "s3://$BUCKET/assets" \
  --cache-control "public, max-age=31536000, immutable"

# Everything else (HTML, favicon, skills, ...): always revalidate. --delete removes stale pages,
# but old fingerprinted assets are kept so cached HTML in browsers keeps working.
aws s3 sync "$OUT" "s3://$BUCKET" --exclude "assets/*" --delete \
  --cache-control "public, max-age=0, must-revalidate"

echo "Invalidating CloudFront $DIST_ID"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*" \
  --query "Invalidation.Id" --output text

echo "Deployed: $SITE_URL"
