# Contact form: Google OAuth setup

## Status

The owner confirmed the Google OAuth app was published. Google was then reconnected, the fresh credentials were saved privately, and the email function was redeployed. A final labelled enquiry on 8 September 2026 was accepted by Gmail on the first attempt. Inbox receipt can be confirmed by the mailbox owner.

The contact form is now enabled in local `js/contact-config.js`. The public website still serves the old page: publish the updated static site through its existing GitHub Pages repository to make the form available to visitors. `_config.yml` excludes backend code and setup files from the Jekyll-built public site. Credentials are never stored in the repository.

Both functions are deployed in `wearglasgow` / `us-central1`, alongside the existing `nam5` Firestore database. Firestore booking rules are preserved and anonymous access to both contact collections is denied. The function mounts `CONTACT_MAILBOX` and `CONTACT_GOOGLE_OAUTH`. Obsolete app-password secret versions are disabled.
## Connect Google

1. Open https://console.cloud.google.com/auth/overview?project=wearglasgow. If prompted, configure Google Auth Platform branding with the app name **Wear Glasgow enquiries** and your chosen support/contact details.
2. Configure the audience. Use **Internal** if the project belongs to the same Workspace organisation and that option is available. Otherwise use **External**, adding the sending mailbox as a test user while setting up. Before permanent use, use an appropriate production publishing status: external apps left in Testing generally receive refresh tokens that expire after seven days for Gmail scopes. Google may require verification depending on audience and usage. Do not treat a temporary test-user setup as permanent production access.
3. Under **Data access**, configure `https://www.googleapis.com/auth/gmail.send`, `openid`, and `https://www.googleapis.com/auth/userinfo.email`. Gmail permission is send-only; the identity scopes let the helper verify that the correct mailbox owner signed in. No inbox-reading or deletion permission is requested.
4. Under **Clients**, create an OAuth client of type **Desktop app**, named **Wear Glasgow mail setup**, and download its JSON file. Desktop is used because the connection helper runs on your computer and receives Google's callback through localhost. Keep the download outside the website folder, for example in Downloads. Do not paste the JSON, client secret or tokens into chat.
5. From PowerShell run:

   ```powershell
   cd G:\WearGlasgowSite
   powershell -File scripts/connect-google-mail.ps1
   ```

   Paste the local JSON file path when prompted. Google sign-in opens in your browser. Sign in to the mailbox already stored privately in Firebase and approve sending. The helper checks the account, then saves `CONTACT_GOOGLE_OAUTH` directly to Secret Manager. It does not print your address or tokens, and it does not write tokens into project files. The existing `CONTACT_MAILBOX` setting is reused. The old `set-contact-secrets.ps1` command now redirects to this OAuth helper.

## Deploy and verify

After the helper confirms the connection, deploy the email function using Node.js 22:

```powershell
firebase deploy --only functions:website-contact:emailEnquiry --project wearglasgow --non-interactive --force
```

This binds `CONTACT_MAILBOX` and `CONTACT_GOOGLE_OAUTH` to the email function. After a new labelled enquiry confirms Gmail accepted delivery, enable the form in `js/contact-config.js` and publish the static website through the existing GitHub Pages process. The browser must use one of the configured website origins. A local file preview is not an allowed form-submission origin.

The obsolete `CONTACT_GOOGLE_APP_PASSWORD` Firebase secret versions have been disabled. Revoke any Google app password created specifically for this form in Google Account settings if one was created. Do not remove unrelated account credentials.

## Privacy and reliability

- The address and OAuth credentials remain backend secrets. The frontend contains only the public function endpoint.
- The helper uses a loopback listener, random state, PKCE and a ten-minute sign-in timeout. It checks the signed-in Google identity matches the configured mailbox before saving credentials.
- Enquiries are stored first; a Firestore trigger sends the notification. The form confirms receipt, not inbox delivery. A successful Gmail API response confirms provider acceptance; inbox arrival should still be checked.
- The existing rate limits, honeypot, idempotent form retry IDs and delivery lease remain. Notification failures retry for up to 24 hours before the record is marked failed. A crash after Gmail accepts a message but before Firestore records success can still produce a duplicate on retry.
- Provider errors are replaced with generic errors. Do not log message bodies, raw OAuth responses, bearer tokens or recipient settings.
- The Gmail API was enabled for the OAuth integration. Google sign-in and one live Gmail API send have been verified; inbox receipt can be confirmed by the mailbox owner.

## Checks

31 local tests pass for input validation, backend storage/deduplication, mail retry states, Gmail API token refresh/send behavior, private error handling, frontend states and OAuth callback state validation. Gmail requests are stubbed in the OAuth tests; they are not a live account authorisation test.

```powershell
node --test functions/contact.test.js functions/backend.test.js functions/google-mail.test.js scripts/contact-ui.test.cjs scripts/google-oauth.test.cjs
```

References:
- https://developers.google.com/identity/protocols/oauth2/native-app
- https://developers.google.com/identity/protocols/oauth2#expiration
- https://developers.google.com/workspace/gmail/api/auth/scopes
- https://developers.google.com/workspace/gmail/api/guides/sending
