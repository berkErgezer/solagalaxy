# Sola Galaxy website

This version includes a shared SQLite database for chapter likes, dislikes, and comments.

## Run locally on Windows

Open Command Prompt in this folder and run:

```cmd
py server.py
```

Then open:

```text
http://localhost:8000
```

Do not open `index.html` directly and do not use `python -m http.server`. Those methods serve only static files and cannot run the feedback database API.

The database is created automatically at:

```text
data/sola_feedback.db
```

All visitors who connect to the same running server share the same likes, dislikes, and comments.

## Pages

- `/` or `/index.html`: About Me
- `/book1.html`: Book 1 and character gallery
- `/tiberius.html`: Tiberius chapters, right-side chapter navigation, and shared feedback

## Put the site online

A static host such as GitHub Pages cannot run this database. Deploy the complete folder to a host that runs Python, such as Render, Railway, Fly.io, or a VPS.

A `render.yaml` file is included. On Render, create a Blueprint from the repository and keep the included persistent disk. The disk stores `sola_feedback.db` so comments and reactions survive redeployments.

If the domain currently points to GitHub Pages, update its DNS after the Python service is deployed.

## Backups

Back up the following file regularly:

```text
data/sola_feedback.db
```

When hosted with the included Render configuration, the database path is `/var/data/sola_feedback.db`.
