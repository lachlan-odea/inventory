# Studio Inventory

Inventory and borrowing tracker for the studio. Track what gear you own, who has
it, when it's due back, and what condition it came back in.

- **Inventory** with quantities — one record can cover 12 XLR cables, not just
  one-of-a-kind gear
- **Check out / check in** against a managed list of borrowers, with partial
  returns (6 cables out, 4 back now, 2 later)
- **Kits** — bundle gear that goes out together ("Interview kit") and check the
  whole lot out in one step (complete or not at all), then check it back in in one
  step from the Kits page — untick anything that is not back yet
- **Due dates** with overdue flagging on the dashboard and a badge in the nav
- **Photos** per item, plus a condition rating and notes recorded on every return
- **Full loan history** per item and per person, exportable to CSV
- Real-time — two people on two devices see the same state instantly

Built as a React + TypeScript single-page app on Firebase (Firestore, Email/Password
Auth, Hosting) with photos hosted on Cloudinary's free tier.

---

## Quick start

```bash
npm install
cp .env.example .env    # then fill in your Firebase web config
npm run dev
```

Open http://localhost:5173. If `.env` isn't filled in yet, the app shows a setup
screen instead of a blank page.

### Trying it without a Firebase project

The Firebase emulators run the whole stack locally — no cloud project, no
account. Requires the Firebase CLI (`npm i -g firebase-tools`) and Java.

```bash
npm run emulators      # terminal 1 — Firestore, Auth on localhost
npm run dev:emulated   # terminal 2 — app pointed at the emulators
```

Photo uploads still hit real Cloudinary even in emulator mode — there's no local
emulator for it, and the free tier doesn't need one.

Emulator data is wiped on exit unless you pass `--export-on-exit`.

---

## Firebase setup (one time)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. In the project, enable:
   - **Firestore Database** — start in production mode; the rules in this repo
     replace the defaults
   - **Authentication → Sign-in method → Email/Password**
3. **Project settings → General → Your apps → Add app → Web**. Copy the config
   values into `.env` (see `.env.example` for the mapping).
4. Link the local repo and push the rules:

   ```bash
   npm i -g firebase-tools
   firebase login
   firebase use --add          # pick your project, alias it "default"
   firebase deploy --only firestore:rules
   ```

`.firebaserc` is gitignored, so each person links their own project (or you
commit it deliberately if the whole studio shares one).

## Photo storage setup (one time)

Firebase Storage now requires the paid Blaze plan just to turn it on, so photos
are hosted on [Cloudinary](https://cloudinary.com) instead — its free tier
(25 GB storage, 25 GB bandwidth/month) needs no card and no backend.

1. Create a free account at [cloudinary.com](https://cloudinary.com).
2. **Dashboard** home page → copy the **Cloud name**.
3. **Settings → Upload → Upload presets → Add upload preset**. Set
   **Signing mode** to **Unsigned**, save, and copy its name.
4. Put both values in `.env` as `VITE_CLOUDINARY_CLOUD_NAME` and
   `VITE_CLOUDINARY_UPLOAD_PRESET`.

Uploads go straight from the browser to Cloudinary (see `src/lib/cloudinary.ts`)
— there's no API secret in the client, so replacing or removing a photo
unlinks it from the item but doesn't delete it from Cloudinary. At this app's
scale that's not worth worrying about; if it ever matters, clean up unused
images from the Cloudinary media library occasionally.

### Deploying

```bash
npm run deploy      # builds, then deploys hosting + rules
```

Firebase Hosting gives you a `https://<project>.web.app` URL. Anyone on that URL
can use the app — see the security note below before sharing it widely.

---

## How the data is modelled

Four Firestore collections:

| Collection | What it holds |
| --- | --- |
| `items` | Gear. Carries `totalQty` (owned) and `availableQty` (on the shelf). |
| `people` | The borrower list. Checkout picks from these. |
| `kits` | Named bundles of items + quantities. Own no stock themselves. |
| `loans` | One document per check-out event. Never deleted — this is the audit trail. |

**Availability is derived but stored.** `availableQty` is decremented at checkout
and incremented at check-in inside a Firestore transaction, so two people
grabbing the last unit at the same moment can't both succeed. Recomputing it from
loans on every read would be correct too, but it makes every inventory list a
fan-out query.

**Partial returns** work by tracking `returnedQty` against `qty` on the loan. The
loan stays `out` until they're equal, then flips to `returned` and stamps
`returnedAt`.

**Kit checkout is all-or-nothing.** One transaction reads every item in the kit
and only writes if all of them are available, then creates one loan per item
tagged with the kit and a shared checkout id. "Check in kit" on the Kits page
returns every ticked item in one transaction; items can still be returned one
at a time from Loans, and partial returns still work.

**Item and person names are denormalised onto loans** so old history still reads
correctly after gear is renamed or someone leaves.

**Items and people archive rather than delete** once they have history. Deleting
is only offered for records that have never been part of a loan.

---

## Security — sign-in and the access list

Everyone signs in with an email and password. An account on its own gets
nothing: the security rules only allow reads and writes when **both**

1. the email address has been **verified** (the user clicked the link Firebase
   emails them — this stops someone registering an address they don't own), and
2. that email is on the **access list** — a doc in the `staff` collection, keyed
   by the lowercased email, with a role of `admin` or `member`.

Admins manage the list on the **Access** tab. To let someone in, add their
email there; they then use **Create an account** on the sign-in page. Removing
them cuts access immediately, including in a tab they already have open.

The owner address is hard-coded as an admin in `isOwner()` in
`firestore.rules` (and mirrored in `OWNER_EMAILS` in `src/lib/auth.tsx`), so the
studio can't lock itself out. The owner's own `staff` entry is created on their
first sign-in. Keep the two lists in sync if you change them.

Setting it up on a project: Firebase console → **Authentication → Sign-in
method** → enable **Email/Password** (and disable Anonymous, which nothing uses
any more), then `firebase deploy --only firestore:rules`.

The Firebase web config in `.env` is **not** a secret — it identifies the project
to the client. Access control lives entirely in `firestore.rules`, which is why
deploying it is a required setup step.

---

## Project layout

```
src/
  lib/
    firebase.ts   Firebase init, emulator wiring
    auth.tsx      Sign-in, email verification, access list (staff) checks
    cloudinary.ts Unsigned photo uploads
    types.ts      Item / Person / Kit / Loan shapes
    kits.ts       Kit availability and tidy-up (pure, unit-tested)
    db.ts         All Firestore reads and writes, incl. the check-in/out transactions
    store.tsx     Live subscriptions -> React context; derived indexes
    format.ts     Dates, due-date maths, loan view models
  components/     Dialogs (check out, check in, item, person, kit) and shared UI
  pages/          Dashboard, Inventory, ItemDetail, Kits, Loans, People, Access, SignIn, Setup
firestore.rules   Database access rules
firebase.json     Hosting + emulator config
```

## Scripts

| Command | Does |
| --- | --- |
| `npm run dev` | Dev server on :5173, reachable from phones on the same wifi |
| `npm run build` | Typecheck then build to `dist/` |
| `npm run typecheck` | Types only |
| `npm run smoke` | Renders every page and dialog against fixture data — no Firebase needed |
| `npm run emulators` | Local Firebase stack |
| `npm run dev:emulated` | Dev server pointed at the emulators |
| `npm run deploy` | Build and deploy to Firebase |

## Possible next steps

- QR labels per item plus phone-camera scanning for one-tap check-in/out
- Email or Slack nudges for overdue loans (Cloud Function on a schedule)
