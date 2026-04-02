# ProspectTrack — Setup Guide
## Get your app live in ~20 minutes

---

## What you'll need
- A free Google account (for Firebase)
- A free GitHub or Vercel account (for hosting)
- This folder of files

---

## STEP 1 — Create your Firebase project

1. Go to **https://firebase.google.com** and click **Get started**
2. Click **Create a project**, name it `prospect-track` (or anything you like)
3. Disable Google Analytics when prompted (not needed), click **Create project**
4. Once created, click **Continue**

---

## STEP 2 — Set up Authentication

1. In the left sidebar, click **Build → Authentication**
2. Click **Get started**
3. Under **Sign-in method**, click **Email/Password**
4. Toggle it **Enabled**, click **Save**

Now create your admin account:
5. Go to the **Users** tab → **Add user**
6. Enter your email and a strong password → **Add user**
7. Copy the **UID** that appears (you'll need it in Step 4)

---

## STEP 3 — Set up Firestore Database

1. In the left sidebar, click **Build → Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** → **Next**
4. Select a location close to you (e.g. `nam5 (us-central)`) → **Enable**

Now set security rules:
5. Click the **Rules** tab and replace everything with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    match /prospects/{id} {
      allow read, write: if request.auth != null;
    }
    match /activity/{id} {
      allow read, write: if request.auth != null;
    }
  }
}
```

6. Click **Publish**

---

## STEP 4 — Create your admin user profile in Firestore

1. In Firestore, click **Start collection**
2. Collection ID: `users` → **Next**
3. Document ID: paste your UID from Step 2
4. Add these fields:
   - `name` (string): Your name
   - `email` (string): Your email
   - `role` (string): `admin`
5. Click **Save**

---

## STEP 5 — Get your Firebase config keys

1. Go to **Project Settings** (gear icon top left)
2. Scroll down to **Your apps** → click the **</>** (Web) icon
3. Register the app (call it `prospect-track-web`)
4. Copy the `firebaseConfig` object that appears

Open the file `js/firebase-config.js` and replace the placeholder values:

```js
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_KEY_HERE",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

---

## STEP 6 — Import your 10 existing prospects

1. In Firestore, open the `prospects` collection (create it if needed)
2. Add each prospect as a document with these fields:

```
mls: "9183921"
status: "Expiré"
listingAddress: "10200 Boul. de l'Acadie, app. 814, Montréal"
contractStart: "2025-09-17"
expiry: "2026-03-31"
lastPrice: 540000
origPrice: 540000
prevPrice: null
agency: "LES IMMEUBLES HOME-PRO MC"
broker: "Amir Keryakes"
brokerPhone: "514-943-2647"
owners: [{ name: "Medhat Azer", street: "10200 Acadie...", city: "Montréal", postal: "H4N 3L3" }]
mail: ["", "", "", ""]
visits: []
createdAt: (use the timestamp button)
createdBy: "YOUR_UID"
```

Alternatively, use the **+ Add Prospect** button inside the app once it's live.

---

## STEP 7 — Deploy to Vercel (free hosting)

**Option A — Drag and drop (easiest):**
1. Go to **https://vercel.com** → Sign up with your Google account
2. Click **Add New → Project**
3. Choose **Deploy without a Git repository**
4. Drag and drop your entire `realty-tracker` folder
5. Click **Deploy**
6. In ~60 seconds you get a URL like `prospect-track-abc123.vercel.app`

**Option B — Via GitHub (recommended for updates):**
1. Create a free account at **https://github.com**
2. Create a new repository called `prospect-track`
3. Upload all your files
4. Go to Vercel → Import from GitHub → select the repo → Deploy
5. Future updates: just push to GitHub, Vercel auto-deploys

---

## STEP 8 — Add your agents

1. In Firebase → **Authentication → Users → Add user**
   - Add Agent 1: their email + temporary password
   - Copy their UID
2. In Firestore → **users collection → Add document**
   - Document ID: their UID
   - Fields: `name`, `email`, `role: "agent"`
3. Repeat for Agent 2
4. Send them the Vercel URL and their temporary credentials

---

## Done! Share the URL with your team.

**Your app URL:** `https://your-project.vercel.app`

Agents bookmark it on their phone home screen:
- **iPhone:** Safari → Share → Add to Home Screen
- **Android:** Chrome → Menu → Add to Home Screen

---

## Your 10 existing prospects (pre-filled data)

| MLS | Owner | Mailing Address | Last Price |
|-----|-------|-----------------|------------|
| 9183921 | Medhat Azer | 10200 Acadie, app. 814, Montréal H4N 3L3 | $540,000 |
| 23238634 | Zahraa Amhaz | 243 Sherbrooke, Montréal H9W 1P6 | $510,000 |
| 26507942 | Lyece Mokrani | 7340 5e ave., Laval H7R 2Z2 | $277,000 |
| 21624280 | Jonathan Tehrani | 2372 Equinox, St-Laurent H4R 0P1 | $295,000 |
| 10790488 | Chen Wang | 1111 Arthur-Lismer, app. 609, Montréal H4N 3J3 | $369,000 |
| 21249887 | Salim Maalouf + Brigitte Dargham | 325/326 Olivier-Chauveau, Laval H7K 3J1 | $369,900 |
| 18928111 | Jovette Gareau | 10671 Larose Av., Montréal H2B 3C4 | $299,900 |
| 23067794 | Tahmid Nazib + Ali Nifola | 10140 Lauraine-Vaillancourt, app. 302, Montréal H3L 0B1 | $565,000 |
| 19722457 | Kiran Jayaramaiah | 10224 St-Laurent, app. 302, Montréal H3L 2N8 | $549,000 |
| 25555209 | Monique Ste-Marie | 7280 Beaufort, app. 503, Montréal H1M 3V7 | $449,000 |

---

## Need help?

If you get stuck on any step, paste the error message and I'll walk you through it.
