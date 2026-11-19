# Google Calendar connection setup

Value Time's Google Calendar integration uses a Supabase Edge Function. Google access and refresh tokens are encrypted before they are stored; the browser never receives those tokens.

## 1. Create Google OAuth credentials

1. Open the Google Cloud Console and select or create a project.
2. Enable the **Google Calendar API**.
3. Configure the OAuth consent screen. If the app is still in Testing, add the Google account you will use as a test user.
4. Create an OAuth Client ID with application type **Web application**.
5. Add this exact Authorized redirect URI:

   `https://emcspruiboxkixcyokka.supabase.co/functions/v1/google-calendar`

6. Keep the Client ID and Client Secret private.

## 2. Create the token-encryption key

Generate a fresh 32-byte key in your browser's developer console (F12 → Console):

```js
const bytes = crypto.getRandomValues(new Uint8Array(32));
const key = btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
console.log(key);
```

Copy the generated value directly into Supabase Function Secrets. Do not put it in GitHub or in a chat message. Keep a secure backup: changing this key later makes previously stored Google tokens unreadable and requires users to reconnect.

## 3. Add Supabase Edge Function secrets

In Supabase Dashboard → Edge Functions → Secrets, add:

| Name | Value |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | The 32-byte base64url key generated above |
| `VALUE_TIME_APP_URL` | The exact public origin of the Value Time app, e.g. `https://your-real-app-domain` (no trailing slash) |

Do not add the Google Client Secret or encryption key to a `NEXT_PUBLIC_...` variable or the GitHub repository.

## 4. Deploy and test

After the Google Calendar changes are merged, deploy the `google-calendar` Edge Function from the repository's `supabase/functions/google-calendar` directory to project `emcspruiboxkixcyokka`. The included `supabase/config.toml` deliberately disables the gateway's legacy JWT check for this callback endpoint; the function itself validates a signed-in user's Supabase JWT for every browser action and validates the one-time OAuth state on the Google callback.

Then open Value Time → Settings → Google Calendar, connect the Google account, and run **Sync timetable now**.

## What sync currently covers

- Timetable entries sync in both directions.
- One-time and weekly recurring timetable entries are supported.
- The sync window is 30 days in the past and 365 days ahead.
- Google all-day events are skipped for now.
- Tasks and assignment deadlines remain in Value Time and are not exported in this first integration pass.
- Disconnecting Google does not delete the user's Value Time timetable.

Google may show an OAuth consent/testing warning until the app's consent screen is published and verified. Only grant access to a Google account you control.
