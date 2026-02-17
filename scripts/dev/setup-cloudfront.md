# CloudFront Setup for Handler Image CDN

This guide covers setting up a CloudFront distribution to serve Handler VM images from S3 with low-latency global distribution.

## Prerequisites

- AWS CLI configured with admin access
- S3 bucket `handler.dev-public` in `us-east-2` with public read access
- (Optional) Custom domain and ACM certificate

## Step 1: Create CloudFront Distribution

```bash
aws cloudfront create-distribution \
  --origin-domain-name handler.dev-public.s3.us-east-2.amazonaws.com \
  --default-root-object index.html \
  --comment "Handler VM Image CDN"
```

Or via the AWS Console:

1. Go to CloudFront > Create Distribution
2. **Origin domain**: `handler.dev-public.s3.us-east-2.amazonaws.com`
3. **Origin access**: Origin Access Control (OAC) — recommended
4. **Cache policy**: `CachingOptimized` (long TTL, ideal for immutable image files)
5. **Viewer protocol policy**: Redirect HTTP to HTTPS
6. **Price class**: Use all edge locations (or restrict to lower cost)

## Step 2: Configure Origin Access Control (OAC)

OAC is the recommended way to restrict S3 access through CloudFront only:

1. In CloudFront, create an OAC for S3
2. Update the S3 bucket policy to allow CloudFront access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontServicePrincipal",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::handler.dev-public/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::ACCOUNT_ID:distribution/DISTRIBUTION_ID"
        }
      }
    }
  ]
}
```

## Step 3: Custom Domain (Optional)

1. Request an ACM certificate in `us-east-1` (required for CloudFront):
   ```bash
   aws acm request-certificate \
     --domain-name cdn.handler.dev \
     --validation-method DNS \
     --region us-east-1
   ```

2. Add DNS validation records to your domain
3. In CloudFront, add the alternate domain name (`cdn.handler.dev`) and select the certificate
4. Add a CNAME record: `cdn.handler.dev -> d1234567890.cloudfront.net`

## Step 4: Configure Upload Script

Add your CloudFront distribution ID to `scripts/dev/.env`:

```bash
CLOUDFRONT_DISTRIBUTION_ID=E1234567890ABC
```

The upload script will automatically invalidate the cache after uploading new images.

## Step 5: Update Download Script

Once CloudFront is active, update the default URL in `scripts/user/download-image.sh`:

```bash
BASE_URL="${HANDLER_IMAGE_URL:-https://cdn.handler.dev/images}"
```

## Cache Behavior

- VM images are immutable (new versions get new checksums)
- Use long TTL (default `CachingOptimized` = 86400s)
- The upload script invalidates `/images/{IMAGE_NAME}/*` on each upload
- `manifest.json` is small and invalidated with each upload, ensuring clients always get the latest checksums

## Monitoring

```bash
# Check distribution status
aws cloudfront get-distribution --id DISTRIBUTION_ID --query 'Distribution.Status'

# View invalidations
aws cloudfront list-invalidations --distribution-id DISTRIBUTION_ID

# Check cache hit ratio in CloudFront console
# Go to CloudFront > Reports & analytics > Cache statistics
```
