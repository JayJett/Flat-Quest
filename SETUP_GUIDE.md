# Flat Quest: setup guide (no experience needed)

These are the only steps that need you. Everything else (the code, the database, the security rules and the checklist data) is already done.

You'll need about **20 minutes** and a computer with a web browser. Do the parts **in order**.

| Part | What it does | Needed? |
| --- | --- | --- |
| 1 | Put the app on the internet (Vercel) | **Yes** |
| 2 | Tell Supabase the app's web address | **Yes** |
| 3 | Make sign-up instant (skip email confirmation) | Recommended |
| 4 | Create your flat and invite everyone | **Yes** |
| 5 | Mark the landlord's appliances | Recommended |
| 6 | Add "Continue with Google" | Optional, can do later |

Words you'll see:
- **GitHub** is where the app's code is stored. You already have it: `JayJett/Flat-Quest`. You don't need to change anything there.
- **Vercel** is a free service that takes the code from GitHub and runs it as a website.
- **Supabase** is the database and login system. Your project there is called **flat-quest**.

---

## Part 1: Put the app on the internet (Vercel)

1. Go to **https://vercel.com/signup**.
2. Choose **Hobby** (the free plan), type your name, and click **Continue**.
3. Click **Continue with GitHub**. Log in to GitHub if asked, then click **Authorize Vercel**.
4. You'll land on a page that says something like **"Let's build something new"**. (If you don't, click **Add New…** in the top-right, then **Project**.)
5. Under **Import Git Repository** you'll see a list of your GitHub repositories.
   - If **Flat-Quest** is in the list, click **Import** next to it.
   - If it is **not** in the list:
     1. Click **Adjust GitHub App Permissions** (or **Install** / **Configure GitHub App**). A GitHub window opens.
     2. Under **Repository access**, choose **All repositories**, or choose **Only select repositories** and pick **Flat-Quest**.
     3. Click **Save** (or **Install**), go back to Vercel, and click **Import** next to Flat-Quest.
6. On the **Configure Project** screen:
   - **Project Name:** type `flat-quest` (or leave what's there).
   - **Framework Preset:** it should say **Vite**. If not, pick Vite from the list.
   - Leave everything else alone. You do **not** need to add environment variables; they're already in the code.
7. Click **Deploy**. Wait about one minute until you see confetti and **"Congratulations!"**.
8. Click **Continue to Dashboard**. Under **Domains** you'll see your app's address, something like `flat-quest-xxxx.vercel.app`.
   - **Write this address down exactly.** You need it in Part 2 and Part 6.
   - In the rest of this guide it's called **YOUR-APP-ADDRESS**. Example: if Vercel shows `flat-quest-abc.vercel.app`, then YOUR-APP-ADDRESS is `https://flat-quest-abc.vercel.app`.

From now on, whenever new code is pushed to GitHub, Vercel updates the website automatically.

---

## Part 2: Tell Supabase the app's address

Without this step, sign-up and password-reset emails would send people to the wrong place.

1. Go to **https://supabase.com/dashboard** and sign in.
2. Click the project called **flat-quest**. (Not "my-budget"; that's your other app.)
3. In the left-hand menu, click **Authentication** (the icon looks like a person or key; hover to see names).
4. In the menu that appears, under **Configuration**, click **URL Configuration**.
5. **Site URL:**
   1. Delete what's in the box (probably `http://localhost:3000`).
   2. Paste YOUR-APP-ADDRESS, e.g. `https://flat-quest-abc.vercel.app`. No slash at the end.
   3. Click **Save changes**.
6. **Redirect URLs:**
   1. Click **Add URL**.
   2. Paste YOUR-APP-ADDRESS followed by `/**`, e.g. `https://flat-quest-abc.vercel.app/**`. Those are two stars.
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

1. Open YOUR-APP-ADDRESS on your phone.
2. Tap **Create an account**, enter your name, email and a password (8+ characters), and tap **Create account**.
   - If you skipped Part 3, check your email and tap the confirmation link first.
3. Tap **Set up our flat**. The name **9 Rua Kai Wai** is already filled in.
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

## Part 5: Mark the landlord's appliances

Your Google Sheet lists the fridge, microwave and washing machine, which the landlord provides. They were imported exactly as the sheet had them, so that nothing was silently changed. For each one:

1. Go to **Rooms** and open **Kitchen** (fridge, microwave) or **Laundry & cleaning** (washing machine).
2. Tap the item.
3. Under **Plan**, tap **Not needed**.
4. Under **Owned by**, choose **Landlord**.
5. Tap **Save changes**.

They'll then stop counting towards your progress.

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
   - **Authorized JavaScript origins:** click **Add URI** and paste YOUR-APP-ADDRESS (e.g. `https://flat-quest-abc.vercel.app`).
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

Reload YOUR-APP-ADDRESS: the **Continue with Google** button now appears on the sign-in screen.

---

## If something goes wrong

| What you see | What to do |
| --- | --- |
| Vercel says the build failed | Click the failed deployment, scroll to the red lines, and paste them to Claude. |
| Confirmation or reset email opens a "localhost" page | Part 2 isn't saved. Check the Site URL and Redirect URL, including the `/**`. |
| "Email rate limit exceeded" | Do Part 3, or wait an hour. |
| Google says **"Access blocked"** or **"redirect_uri_mismatch"** | In Google Cloud → Clients → your client, check the redirect URI exactly matches the one in step 6a.6, and that the person is listed under **Test users**. |
| "This invite link is invalid or has expired" | Create a fresh link in **Flatmates → Invite a flatmate**. |
| Anything else | Tell Claude what you tapped and what appeared, with a screenshot if possible. |
