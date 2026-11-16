# Keyless Storage Access from Vercel

The Next.js server supports Vercel OIDC through Google Workload Identity
Federation. Service account key creation can remain disabled. This setup grants
the production deployment read access to the existing private data bucket.

## 1. Vercel Identity

For the supplied Vercel dashboard URL:

- Team slug: `kalyah-uis-projects`
- Project name: `nasa-space-apps-2026`
- Production subject: `owner:kalyah-uis-projects:project:nasa-space-apps-2026:environment:production`

In the Vercel project's Settings, find **Secure backend access with OIDC
federation** (under Security) and use the **Team** issuer mode.

## 2. Google Cloud Trust

Select project `project-940193e6-7c25-4e42-abf` (number `139484231017`). Enable the IAM, Security Token Service,
and IAM Service Account Credentials APIs in **APIs & Services → Library**.

In **IAM & Admin → Workload Identity Federation**, create an enabled pool with
ID `vercel`, and an OIDC provider with ID `vercel`. Set:

| Field | Value |
| --- | --- |
| Issuer URL | `https://oidc.vercel.com/kalyah-uis-projects` |
| Audience option | Allowed audiences |
| Allowed audience | `https://vercel.com/kalyah-uis-projects` |
| Attribute mapping | `google.subject` = `assertion.sub` |
| Attribute condition | `assertion.sub == 'owner:kalyah-uis-projects:project:nasa-space-apps-2026:environment:production'` |

Leave the JWK upload empty. This app uses the standard Vercel token audience;
do not choose Google's Default audience option for this implementation.

## 3. Connect the Service Account

Use service account
`loam-vercel@project-940193e6-7c25-4e42-abf.iam.gserviceaccount.com`.

On that service account's **Permissions / Manage access** page, grant
**Workload Identity User** (`roles/iam.workloadIdentityUser`) to this principal:

```text
principal://iam.googleapis.com/projects/139484231017/locations/global/workloadIdentityPools/vercel/subject/owner:kalyah-uis-projects:project:nasa-space-apps-2026:environment:production
```

On **Cloud Storage → nasa_spaceapps_2026_loam → Permissions**, grant the service
account email **Storage Object Viewer**. This allows reading the map datasets.
Saving/deleting fields and uploading CSVs require additional write permissions;
configure those separately if needed.

## 4. Vercel Environment Variables

Set these for **Production**:

```dotenv
GOOGLE_CLOUD_PROJECT=project-940193e6-7c25-4e42-abf
GCS_BUCKET_NAME=nasa_spaceapps_2026_loam
GCP_PROJECT_NUMBER=139484231017
GCP_SERVICE_ACCOUNT_EMAIL=loam-vercel@project-940193e6-7c25-4e42-abf.iam.gserviceaccount.com
GCP_WORKLOAD_IDENTITY_POOL_ID=vercel
GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel
```

Keep `NEXT_PUBLIC_DATA_PROVIDER=api` and your existing Mapbox token. No JSON key,
manually copied OIDC token, or `GCP_SERVICE_ACCOUNT_JSON` variable is needed.
The four federation variables must be configured together; they take precedence
over legacy JSON credentials. Local development and Cloud Run continue to use
Application Default Credentials when the federation variables are absent.

Preview deployments are excluded by this configuration. To enable them, add
their exact subject to both the provider condition and service account binding,
then configure the variables for Preview too.

## 5. Deploy and Verify

Deploy the updated code and environment settings. Check that
`processed/fields/ontario-fields.geojson` exists in the private bucket, then open
`/api/fields` on the production deployment. A successful response is GeoJSON
with `type: "FeatureCollection"`. Reopen Field Info to verify the boundaries.

For failures, check the Vercel function logs for `Could not load fields`:

- Token exchange rejected: compare issuer, audience, subject, and provider condition.
- Impersonation denied: check the service account's Workload Identity User binding.
- Storage access denied: check the service account's bucket permissions.
- Missing object: publish the prepared catalog with `npm run publish:fields`
  from a machine with Google Application Default Credentials.

Setup references: [Vercel OIDC](https://vercel.com/docs/oidc/gcp),
[Vercel token claims](https://vercel.com/docs/oidc/reference), and
[Google federation permissions](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-other-providers).
