# Multi-tenant rollout — one deployment, many client centers

**What changed in one sentence:** every client center now lives inside its own
*organization* on a single shared deployment, and the database itself (not the
screens) guarantees one center can never read, change, or even detect another's data.

## How it works

| Piece | What it does |
|---|---|
| **Organization** | One per client center. Everyone belongs to exactly one. |
| **Platform admin** (you) | Creates and manages clients from the new **Clients** page. Sees counts and activity only — *never* a client's stock data. |
| **Super Admin** (per client) | The client's top person. Adds their own departments, Head Staff, Admins and Staff. |
| **Suspend** | One click locks a whole client out instantly; their data is kept. Reactivate any time. |
| **Isolation** | Postgres row-level security on every table, plus server-side checks on every privileged action. |

Hosting is now **shared**: one Supabase project and one Vercel project serve every
center, so adding a client no longer adds a hosting bill.

---

## Rollout — do these in order

> Run the database step, then deploy the code right after. Between the two, only
> "create user" is affected (the live app can't set an organization yet) — everything
> else keeps working.

### 1. Run the migration
Supabase → **SQL Editor** → New snippet → paste **`20260915100000_multi_tenant.sql`** → Run.

It is **one transaction**: if anything fails, *nothing* is applied and your database is
exactly as it was. Paste me the error and we fix it. All your current data becomes a client
organization called **Maslow** — nothing changes for today's users.

### 2. Make yourself a platform admin
New snippet, run once:
```sql
insert into public.platform_admins (user_id)
select id from auth.users where email = 'urboikelvin13@yahoo.com'
on conflict do nothing;
```

### 3. Update the low-stock email function
Supabase → **Edge Functions** → `low-stock-alert` → replace the code with
**`low-stock-alert-multitenant.ts`** → Deploy. Secrets stay as they are.

> This matters: the old function emailed **every admin on the platform**. The new one
> emails only the item's own organization — its Super Admins, Head Staff, and that
> department's Admins.

### 4. Turn off public sign-ups
Supabase → **Authentication** → sign-in/providers settings → switch **"Allow new users to sign up" OFF**.
Accounts are now created by a client's admin (or by you when onboarding), and that keeps
working. The sign-in page no longer shows "Register".

### 5. Deploy the code
Copy the project files into your git-connected folder, then:
```sh
git add .
git commit -m "Multi-tenant: organizations, clients console, org-scoped security"
git push
```
Vercel redeploys on its own.

---

## Test it properly (15 minutes)

1. **Sign in as yourself.** You should see a new **Clients** link. Your Maslow data is
   unchanged and the header shows your organization's name.
2. **Clients → New client.** Create "Test Center" with a first administrator (any email, a
   temporary password of 8+ characters).
3. **Incognito window → sign in as that administrator.** Expected: empty dashboard, header
   says TEST CENTER, Users shows only themselves, Departments shows "General". They
   should see *none* of Maslow's items, people, or history.
4. **Create an item in Test Center**, then check your own Maslow session — it must not appear.
5. **Clients → Suspend Test Center**, refresh the incognito window → "Access suspended".
   Reactivate → it works again.
6. **Try to break it (optional):** as the Test Center admin, the Users page must never
   list a Maslow person.

### Optional: prove isolation in SQL
```sql
-- find ids
select u.email, o.name as organization, u.id
from auth.users u
join public.user_roles ur on ur.user_id = u.id
join public.organizations o on o.id = ur.organization_id
order by o.name;

-- act as one person (paste their id). Read-only, rolled back at the end.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"PASTE-USER-ID","role":"authenticated"}', true);
select (select count(*) from items)       as items_visible,
       (select count(*) from profiles)    as people_visible,
       (select count(*) from departments) as departments_visible,
       (select count(*) from audit_log)   as audit_rows_visible;
rollback;
```
Run it once per client's user: each must see only their own organization's numbers.

---

## Things to know

- **Resend:** until you verify a domain, it only delivers to *your own* address. Verify one
  before onboarding real clients, or their alerts won't arrive.
- **Product name:** the neutral name "Inventory Hub" lives in one line, `src/lib/brand.ts`.
  Change it to whatever you want to sell this as. Each client's own name shows in their header.
- **Suspension is manual** by design — nobody gets locked out by a timezone or a late
  payment. The **Renews** column flags overdue clients so you can decide.
- **Pricing/hosting:** with real paying clients, move to Supabase Pro (backups, no
  auto-pause) and Vercel Pro (commercial use) — one shared cost, not per client.
- **Not built yet (natural next steps):** a reseller view so Dr Osa can see her own
  clients, automated billing, per-client logo, exporting a client's data on exit.
