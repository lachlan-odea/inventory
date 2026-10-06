# Studio Stock

Inventory and borrowing tracker for the studio. Track what gear you own, who has
it, when it's due back, and what condition it came back in.

- **Inventory** with quantities — one record can cover 12 XLR cables, not just
  one-of-a-kind gear
- **Check out / check in** against a managed list of borrowers, with partial
  returns (6 cables out, 4 back now, 2 later)
- **Due dates** with overdue flagging on the dashboard and a badge in the nav
- **Photos** per item, plus a condition rating and notes recorded on every return
- **Full loan history** per item and per person, exportable to CSV
- Real-time — two people on two devices see the same state instantly

Built as a React + TypeScript single-page app on Firebase (Firestore, Anonymous
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
   - **Authentication → Sign-in method → Anonymous**
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

Three Firestore collections:

| Collection | What it holds |
| --- | --- |
| `items` | Gear. Carries `totalQty` (owned) and `availableQty` (on the shelf). |
| `people` | The borrower list. Checkout picks from these. |
| `loans` | One document per check-out event. Never deleted — this is the audit trail. |

**Availability is derived but stored.** `availableQty` is decremented at checkout
and incremented at check-in inside a Firestore transaction, so two people
grabbing the last unit at the same moment can't both succeed. Recomputing it from
loans on every read would be correct too, but it makes every inventory list a
fan-out query.

**Partial returns** work by tracking `returnedQty` against `qty` on the loan. The
loan stays `out` until they're equal, then flips to `returned` and stamps
`returnedAt`.

**Item and person names are denormalised onto loans** so old history still reads
correctly after gear is renamed or someone leaves.

**Items and people archive rather than delete** once they have history. Deleting
is only offered for records that have never been part of a loan.

---

## Security — read this before sharing the URL

Every visitor is signed in anonymously so the security rules have something to
check. That keeps unauthenticated scripts and random internet traffic out, but
**anyone who can load the app URL can read and write the data.** For a studio
tool on an internal-ish URL that's usually the right trade — nobody has to
remember another login.

If that isn't good enough for you, switch to Google sign-in with an allowlist:

1. Enable **Google** as a sign-in provider in the Firebase console.
2. Replace `signInAnonymously` in `src/lib/firebase.ts` with
   `signInWithPopup(auth, new GoogleAuthProvider())`.
3. Create a `staff` collection with one doc per allowed email address.
4. In `firestore.rules`, uncomment `isStaff()` and swap `signedIn()` for it.

The Firebase web config in `.env` is **not** a secret — it identifies the project
to the client. Access control lives entirely in `firestore.rules`, which is why
deploying it is a required setup step.

---

## Project layout

```
src/
  lib/
    firebase.ts   Firebase init, emulator wiring, anonymous sign-in
    cloudinary.ts Unsigned photo uploads
    types.ts      Item / Person / Loan shapes
    db.ts         All Firestore reads and writes, incl. the check-in/out transactions
    store.tsx     Live subscriptions -> React context; derived indexes
    format.ts     Dates, due-date maths, loan view models
  components/     Dialogs (check out, check in, item, person) and shared UI
  pages/          Dashboard, Inventory, ItemDetail, Loans, People, Setup
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
- Kit bundles — check out "Interview kit" and have it move six items at once
