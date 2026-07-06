# The Grand Conquest of the Sola Galaxy

This version is built for GitHub Pages. All website files are static HTML, CSS, and JavaScript. Shared likes, dislikes, and comments are stored in Supabase, so they work for every visitor even though GitHub Pages cannot run Python or SQLite.

## 1. Create the shared feedback database

1. Create a Supabase project.
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste and run the entire contents of `supabase-schema.sql`.
4. Open **Authentication > Providers > Anonymous Sign-Ins** and enable anonymous sign-ins.
5. Open **Project Settings > API**.
6. Copy the Project URL and the Publishable key. A legacy anon key also works.
7. Open `feedback-config.js` and replace the two placeholder values.

Example:

```js
window.SOLA_FEEDBACK_CONFIG = {
  supabaseUrl: 'https://abc123.supabase.co',
  supabasePublishableKey: 'sb_publishable_your_key_here'
};
```

The publishable or anon key is designed for browser use. Never put a Supabase secret key or service-role key in this repository.

## 2. Test locally

Because the feedback code is an ES module, test through a local server rather than opening the HTML file directly.

```cmd
py -m http.server 8000
```

Then open:

```text
http://localhost:8000/tiberius.html
```

The Python command is only serving static files. The comments database is Supabase, not Python.

## 3. Publish with GitHub Pages

Push the folder contents to the `main` branch of the repository.

In GitHub:

1. Open **Settings > Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select `main` and `/ (root)`.
4. Save.

The site will load the shared feedback directly from Supabase. No `server.py`, Render service, or SQLite database is required.

## Feedback behavior

- Every browser receives an anonymous Supabase account automatically.
- Each anonymous account can have one Like or Dislike per chapter.
- Selecting the same reaction again removes it.
- Comments and reaction totals are shared between all visitors.
- The page refreshes the displayed data after a successful reaction or comment.
- Comments are displayed using text-only DOM APIs to prevent submitted HTML from being rendered.

## Files used for feedback

- `feedback-config.js`: Supabase project URL and browser-safe publishable key
- `feedback.js`: browser feedback logic
- `supabase-schema.sql`: tables, permissions, and row-level security policies

## Arifin reader

`arifin.html` contains the supplied Arifin chapter and artwork. The Arifin card on
`book1.html` now opens this reader page. Its reactions and comments use the
chapter ID `arifin-rensa-korlin`.

Run the current `supabase-schema.sql` again in the Supabase SQL Editor before
publishing this update. It removes the old fixed chapter allowlist so Arifin and
future character chapters can use shared feedback.

