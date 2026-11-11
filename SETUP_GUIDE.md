# Flat Quest: setup guide (no experience needed)

These are the only steps that need you. Everything else (the code, the database, the security rules and the checklist data) is already done.

You'll need about **10 minutes** and a computer with a web browser. Do the parts **in order**.

Your app's web address will be:

**https://jayjett.github.io/Flat-Quest/**

It's hosted the same way as Moni Money, on GitHub Pages, so there are no new accounts to create.

| Part | What it does | Needed? |
| --- | --- | --- |
| 1 | Switch on GitHub Pages for Flat-Quest | **Yes** |
| 2 | Tell Supabase the app's web address | **Yes** |
| 3 | Make sign-up instant (skip email confirmation) | Recommended |
| 4 | Create your flat and invite everyone | **Yes** |
| 5 | Landlord's appliances | Already done for you |
| 6 | Add "Continue with Google" | Optional, can do later |
| 7 | Security settings | Recommended |

Words you'll see:
- **GitHub** is where the app's code is stored (`JayJett/Flat-Quest`), and also what hosts the website.
- **Supabase** is the database and login system. Your project there is called **flat-quest**.

### Why is this different from Moni Money?

Moni Money is written as plain web pages, so GitHub can show its files directly.

Flat Quest is written in a format that has to be **built** (converted into web pages) first. I've added an automatic GitHub robot (a "GitHub Actions workflow") that does that build every time the code changes and publishes the result. The only difference for you is one setting in Part 1: telling GitHub to publish what the robot builds instead of the raw files.

---

## Part 1: Switch on GitHub Pages (2 minutes)

1. Go to **https://github.com/JayJett/Flat-Quest** and sign in if asked.
2. Near the top of the page, click **Settings** (the gear icon, on the right of the row that starts with **Code**).
3. In the left-hand menu, under **Code and automation**, click **Pages**.
4. Under **Build and deployment**, find **Source** and change it to **GitHub Actions**. (It may say "Deploy from a branch" right now.)
   - It saves by itself; there's no Save button.
5. Now start the first build:
   1. Click **Actions** in the top row of tabs.
   2. In the left list, click **Build and publish to GitHub Pages**.
   3. Click the **Run workflow** button on the right, then the green **Run workflow** button in the box that appears.
6. Wait about 2 minutes. Refresh the page; when the run shows a **green tick** ✅, the app is live at **https://jayjett.github.io/Flat-Quest/**.
   - A red ❌ means something failed: click it and send Claude a screenshot.

From now on, every time Claude pushes new code, GitHub rebuilds and republishes the app automatically.

---

## Part 2: Tell Supabase the app's address (2 minutes)

Without this step, sign-up and password-reset emails would send people to the wrong place.

1. Go to **https://supabase.com/dashboard** and sign in.
2. Click the project called **flat-quest**. (Not "my-budget"; that's Moni Money.)
3. In the left-hand menu, click **Authentication** (hover over the icons to see their names).
4. In the menu that appears, under **Configuration**, click **URL Configuration**.
5. **Site URL:**
   1. Delete what's in the box (probably `http://localhost:3000`).
   2. Paste exactly: `https://jayjett.github.io/Flat-Quest`
   3. Click **Save changes**.
6. **Redirect URLs:**
   1. Click **Add URL**.
   2. Paste exactly: `https://jayjett.github.io/Flat-Quest/**` (two stars at the end).
   3. Click **Save URLs**.

---

## Part 3: Make sign-up instant (recommended)

By default, Supabase emails a confirmation link to every new account. Its free email sender only allows a few emails per hour, so four people signing up at once can get stuck. For a private flat app, it's simpler to switch confirmation off.

Strangers still can't see anything. Without an invite link from someone in your flat, a new account sees an empty "Let's find your flat" screen. The security tests confirmed this.

1. Still in Supabase, in the **Authentication** menu, click **Sign In / Providers**.
2. Look for a switch called **Confirm email**.
   - Supabase sometimes moves it: it's either on this page in a section called **User Signups**, or inside the **Email** provider (click **Email** in the provider list to open it).
3. Turn **Confirm email** **off**.
4. Click **Save** (or **Save changes**).

(If you'd rather keep confirmation on, leave this alone. If emails stop arriving, wait an hour and try again.)

---

## Part 4: Create your flat and invite everyone

**Jarden (or whoever sets it up):**

1. Open **https://jayjett.github.io/Flat-Quest/** on your phone.
2. Tap **Create an account**, enter your name, email and a password (8+ characters), and tap **Create account**.
   - If you skipped Part 3, check your email and tap the confirmation link first.
3. Tap **Set up our flat** and type the flat’s name.
4. Leave **Start with our checklist** switched **on** (this loads all 103 items from your Google Sheet), then tap **Create flat**.
5. Tap **Flatmates** at the bottom, then **Invite a flatmate**, then **Create invite link**.
6. Tap **Share** (or **Copy link**) and send it to Madi, Emily and Dan in your group chat.
   - One link works for up to 4 people and lasts 7 days. You can make new ones any time.

**Everyone else:**

1. Tap the invite link.
2. Tap **Create account** (or sign in), and you'll come straight back to the invite.
3. Tap **Join the flat**.
4. Optional: tap your picture in the top-left, then **Profile**, to add a photo, colour and icon.

**Put it on your home screen (iPhone):** open the app in **Safari**, tap the **Share** button (square with an up arrow), then **Add to Home Screen**, then **Add**. It then opens full-screen like a normal app.

---

## Part 5: Landlord's appliances (already done)

The fridge/freezer, microwave and washing machine are marked **Provided with flat** (owned by the landlord), and a dishwasher and dryer were added. Tick each one once you’ve checked it’s actually there; they never show up as things to buy.

---

## Part 6 (optional): Add "Continue with Google"

Email sign-in works without this. The Google button stays hidden until this is set up, then appears by itself. This part is the fiddliest (about 10 minutes); do it whenever you like.

### 6a. Create the Google login settings

1. Go to **https://console.cloud.google.com** and sign in with your Google account. Accept the terms if asked.
2. At the top of the page, click the **project picker** (it may say **Select a project**). Then click **New Project**, name it `Flat Quest`, and click **Create**. Wait a few seconds, open the project picker again and select **Flat Quest**.
3. In the search bar at the top, type **Google Auth Platform** and click it.
4. Click **Get started** and fill in:
   1. **App name:** `Flat Quest`. **User support email:** your email. Click **Next**.
   2. **Audience:** choose **External**. Click **Next**.
   3. **Contact information:** your email. Click **Next**.
   4. Tick **I agree…**, click **Continue**, then **Create**.
5. In the left menu, click **Audience**. Under **Test users**, click **Add users**, enter the Gmail addresses of all four flatmates, and click **Save**.
   - Only these people can use Google sign-in while the app is in "Testing", which is what you want for a private app.
6. In the left menu, click **Clients**, then **Create client**:
   - **Application type:** **Web application**.
   - **Name:** `Flat Quest web`.
   - **Authorized JavaScript origins:** click **Add URI** and paste exactly: `https://jayjett.github.io`
   - **Authorized redirect URIs:** click **Add URI** and paste exactly:
     `https://ivnovvdpkxrqsmsiqhid.supabase.co/auth/v1/callback`
   - Click **Create**.
7. A box shows your **Client ID** and **Client secret**.
   - Copy both somewhere safe for the next step (e.g. a note on your phone).
   - **Don't share the secret** with anyone or paste it into chat.

### 6b. Give them to Supabase

1. In Supabase (project **flat-quest**), go to **Authentication** → **Sign In / Providers**.
2. Click **Google**.
3. Turn **Enable Sign in with Google** on.
4. Paste the **Client ID** into **Client IDs**, and the **Client secret** into **Client Secret (for OAuth)**.
5. Click **Save**.

Reload https://jayjett.github.io/Flat-Quest/: the **Continue with Google** button now appears on the sign-in screen.

---

## Part 7 (recommended): Security settings

**Block leaked passwords.** This stops people choosing passwords known from data breaches.
1. In Supabase (project **flat-quest**), open **Authentication**.
2. Look for **Attack Protection** (or it may be under **Sign In / Providers → Email**).
3. Turn on **Prevent use of leaked passwords**, then click **Save**.
   - If it says this needs a paid plan, skip it. The app already requires passwords of 8+ characters.

**Your address in GitHub.** The current files no longer contain the flat’s street address, but early versions in the GitHub history still do, because the repository is public. GitHub Pages hosting is free only for public repositories, so making it private would take the app offline unless you pay for GitHub Pro. Ask Claude if you’d like the history cleaned up instead.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| The GitHub Actions run has a red ❌ | Click it, click the failed step, and send Claude a screenshot. |
| The address shows a GitHub "404" page | Part 1 step 4 isn't set to **GitHub Actions**, or the first run hasn't finished. |
| Confirmation or reset email opens a "localhost" page | Part 2 isn't saved. Check the Site URL and Redirect URL, including the `/**`. |
| "Email rate limit exceeded" | Do Part 3, or wait an hour. |
| Google says **"Access blocked"** or **"redirect_uri_mismatch"** | In Google Cloud → Clients → your client, check the redirect URI exactly matches the one in step 6a.6, and that the person is listed under **Test users**. |
| "This invite link is invalid or has expired" | Create a fresh link in **Flatmates → Invite a flatmate**. |
| Anything else | Tell Claude what you tapped and what appeared, with a screenshot if possible. |
