# PAIA feedback relay

This Cloudflare Worker receives the small feedback payload from the Android app
and creates a Gitee issue. The Gitee personal access token is stored only as the
Worker secret GITEE_TOKEN; it must never be added to the APK or committed.

After deployment, set feedbackApiUrl in ../app-config.json to the Worker's
HTTPS /v1/feedback URL and publish the website repository.
