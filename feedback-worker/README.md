# PAIA feedback relay

This Cloudflare Worker receives the small feedback payload from the Android app
and writes each submission to `feedback/YYYY-MM-DD/<request-id>.json` in a
Gitee repository. Use a private repository such as `paia-feedback` so device
details and user comments are not published with the website.

Set these Worker variables:

- `GITEE_OWNER=Houton_Bosta`
- `GITEE_FEEDBACK_REPO=paia-feedback`
- `GITEE_BRANCH=master`

Store the Gitee personal access token only as the Worker secret
`GITEE_TOKEN`; it must never be added to the APK or committed.

After deployment, set feedbackApiUrl in ../app-config.json to the Worker's
HTTPS /v1/feedback URL and publish the website repository.
