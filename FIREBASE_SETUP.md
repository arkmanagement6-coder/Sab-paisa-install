# Firebase Setup Guide (Sabchira Website)

This guide will walk you through setting up and connecting your Firebase Firestore database for the Sabchira website. Once connected, your catalog and settings will be synchronized globally in real-time across all users' devices.

---

## Step 1: Create a Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add Project** (or **Create a project**).
3. Enter a project name (e.g., `sabchira-shop`).
4. (Optional) Enable/disable Google Analytics for the project, then click **Create Project**.
5. Wait for the setup to complete and click **Continue**.

---

## Step 2: Enable Cloud Firestore
1. In the left-hand navigation sidebar, click on **Build** -> **Firestore Database**.
2. Click the **Create database** button.
3. Choose a database location close to your users (e.g., `asia-south1` for India) and click **Next**.
4. Start in **Test mode** (which allows reads/writes for testing). Click **Create**.
5. Once created, you will see an empty Firestore database.

---

## Step 3: Configure Security Rules
To make sure your website can read and write data (e.g., syncing products, updating order settings from the admin panel), you must configure security rules:
1. In the Firestore console, click on the **Rules** tab.
2. Replace the rules with the following configuration (this allows open read/write access for simplicity, or restricted access if you add auth later):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

3. Click **Publish** to deploy the new rules.

---

## Step 4: Register a Web App & Get Credentials
1. Go back to the **Project Overview** (click the gear icon ⚙️ next to Project Overview in the sidebar and choose **Project settings**).
2. Under the **General** tab, scroll down to the *Your apps* section.
3. Click the **Web** icon (looks like `</>`).
4. Register your app with a nickname (e.g., `sabchira-web`). Leave "Firebase Hosting" unchecked. Click **Register app**.
5. Under the **SDK setup and configuration** section, select the **Config** option.
6. Copy the `firebaseConfig` object. It looks like this:

```json
{
  "apiKey": "YOUR_API_KEY",
  "authDomain": "YOUR_PROJECT_ID.firebaseapp.com",
  "projectId": "YOUR_PROJECT_ID",
  "storageBucket": "YOUR_PROJECT_ID.firebasestorage.app",
  "messagingSenderId": "YOUR_MESSAGING_SENDER_ID",
  "appId": "YOUR_APP_ID",
  "measurementId": "YOUR_MEASUREMENT_ID"
}
```

---

## Step 5: Update Your Project Settings
You can apply the configuration parameters in two ways:

### Option A: Direct JSON Edit (Recommended)
1. Open the [settings.json](file:///e:/Websites/sabchira/settings.json) file in your codebase.
2. Update the file to enable Firebase and paste your credentials:

```json
{
  "sabpaisaEnabled": false,
  ...
  "firebaseEnabled": true,
  "firebaseConfig": {
    "apiKey": "YOUR_API_KEY",
    "authDomain": "YOUR_PROJECT_ID.firebaseapp.com",
    "projectId": "YOUR_PROJECT_ID",
    "storageBucket": "YOUR_PROJECT_ID.firebasestorage.app",
    "messagingSenderId": "YOUR_MESSAGING_SENDER_ID",
    "appId": "YOUR_APP_ID",
    "measurementId": "YOUR_MEASUREMENT_ID"
  }
}
```
3. Commit and redeploy the code.

### Option B: Via Website Admin Panel
1. Open your local site and navigate to `/admin.html`.
2. Scroll to the **Firebase Real-Time Database** section.
3. Check the **Enable Firebase Cloud Database** option.
4. Paste your config JSON object into the input box.
5. Click **Save Settings**. (Note: This saves locally in your browser's localStorage. To publish it live, copy it to `settings.json` as shown in Option A).

---

## Step 6: Automatic Database Seeding
Once Firebase is connected and the site is opened for the first time:
- The codebase will automatically check if the database is empty.
- If no products or settings exist, it will **auto-seed** the database with your default catalog (`products.json`) and initialize global settings.
- You can then manage the database and add/edit products directly from the `/admin.html` page, and changes will update in real-time for all customers!
