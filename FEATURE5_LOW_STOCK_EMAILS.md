# Feature 5: Low-stock email alerts — setup guide

This feature has three pieces, and they need to go in **this order**:

1. Sign up for Resend (the email-sending service) and get an API key.
2. Deploy the Edge Function that actually sends the email.
3. Run the database migration + connect it to your deployed function.

Don't skip ahead — step 3 needs the URL from step 2.

---

## Step 1: Resend account + API key

1. Go to [resend.com](https://resend.com) and sign up (free tier covers this
   easily — a few hundred emails/month for a low-stock alert use case).
2. Once logged in, go to **API Keys** in the sidebar → **Create API Key**.
   Give it a name like "Maslow Inventory" → copy the key it shows you
   (starts with `re_...`). You won't be able to see it again, so save it
   somewhere for a minute.
3. **About the "from" address** — Resend won't let you send from just any
   email until you verify a domain you own (**Domains** → **Add Domain**,
   then add the DNS records it gives you). Verifying a domain takes a bit of
   DNS setup, so **for now**, skip that and just use Resend's built-in test
   address: `onboarding@resend.dev`. It works immediately, no setup — the
   only catch is it can only send to the *email address you signed up to
   Resend with*, which is fine for testing this feature. Once you're ready
   to go live for real staff, come back and verify your own domain, then
   swap the from-address (step 2 below covers where).

## Step 2: Deploy the Edge Function

You don't need the Supabase CLI for this — the dashboard has a built-in
editor.

1. In your Supabase project, click **Edge Functions** in the left sidebar.
2. Click **Create a new function** (or **Deploy a new function**).
3. Name it exactly: `low-stock-alert`
4. It'll open a code editor (or ask you to paste code) — open the file
   `low-stock-alert-index.ts` I've attached, select all, copy, and paste it
   in, replacing whatever placeholder code is there. Click **Deploy**.
5. Once deployed, click into the function and go to its **Secrets** tab (or
   there may be a project-wide **Edge Functions → Secrets** page — either
   works, secrets set at the project level apply to all functions). Add
   these three:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | the `re_...` key from Step 1 |
   | `LOW_STOCK_FROM_EMAIL` | `onboarding@resend.dev` (or your verified domain address later) |
   | `LOW_STOCK_HOOK_SECRET` | make up any long random string — e.g. mash your keyboard for 30 characters. Save it, you need the exact same value in Step 3. |

   (`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to every
   Edge Function automatically — you don't add those.)

6. Copy the function's URL — it's shown on the function's page, and follows
   this pattern:
   ```
   https://wlvnavcxhjdbvfftxsrf.supabase.co/functions/v1/low-stock-alert
   ```
   (using your actual project ref, which you already have).

## Step 3: Run the database migration

1. SQL Editor → **New snippet**.
2. Paste in the contents of `20260828100000_low_stock_email_notifications.sql`
   → **Run**. This adds the tracking column, the trigger, and the dedup
   logic.
3. Open a **second new snippet** and run these two statements, filling in
   your real values from Step 2 (the function URL, and the exact same
   random secret you set as `LOW_STOCK_HOOK_SECRET`):

   ```sql
   alter database postgres set app.settings.low_stock_webhook_url =
     'https://wlvnavcxhjdbvfftxsrf.supabase.co/functions/v1/low-stock-alert';
   alter database postgres set app.settings.low_stock_hook_secret =
     'paste-the-exact-same-random-string-here';
   ```

That's the whole setup. No app code changes needed on the frontend for this
one — it's entirely database + Edge Function.

---

## How to test it

1. Make sure your own account (or whichever email you signed up to Resend
   with) has an **admin** or **super_admin** role — check the Users page.
2. Go to **Items**, pick any item, and either lower its balance (log a
   Stock Out that drops it to/below its reorder threshold) or just edit the
   item and raise its reorder threshold above the current balance. Save.
3. Check the inbox for that Resend account — you should get an email within
   a few seconds with the item name, current quantity, and threshold.
4. **Test the dedup**: without restocking, edit that same item again (e.g.
   change its name or another field) and save. You should **not** get a
   second email — it only fires once per low-stock episode.
5. **Test the reset**: restock the item back above its threshold (log a
   Stock In), then drop it low again. You should get a **new** email this
   time — confirming the alert resets after restocking.

If no email arrives, the most common causes are: the two `alter database`
values weren't set (or don't match what's in the function's secrets), the
Edge Function didn't deploy successfully, or — if you're using the sandbox
`onboarding@resend.dev` address — you're checking a different inbox than
the one you signed up to Resend with. Paste me whatever error you see (the
Edge Function's **Logs** tab in the Supabase dashboard is the best place to
check) and I'll help you debug it.
