# Deploying Insurance Analytics (no GitHub Actions)

Your app is a **static site** (HTML, CSS, JS, plus `data/analytics.json`). You can get a shareable URL in two ways.

---

## Option 1: GitHub Pages (recommended — no Actions)

Your repo already has a `deploy.py` script that pushes the built site to a `gh-pages` branch. GitHub Pages serves from that branch **without using GitHub Actions**.

### One-time setup

1. **Push your repo to GitHub** (if not already):
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/insurance-analytics.git
   git push -u origin main
   ```

2. **Turn on GitHub Pages** (no Actions involved):
   - Open the repo on GitHub → **Settings** → **Pages** (left sidebar).
   - Under **Build and deployment**:
     - **Source**: "Deploy from a branch"
     - **Branch**: `gh-pages` (or create it with the first deploy)
     - **Folder**: `/ (root)`
   - Save. The site URL will be:  
     `https://YOUR_USERNAME.github.io/insurance-analytics/`

### Every time you want to update the live site

From your project folder (with a clean git state, or only `data/analytics.json` changed):

```bash
python deploy.py
```

This will:

- Generate fresh data (`backend/generate_data.py`)
- Copy `index.html`, `css/`, `js/`, `data/` to a `gh-pages` branch
- Push `gh-pages` to GitHub

GitHub then serves the site from `gh-pages`; no Actions run.

---

## Option 2: Netlify (if GitHub Pages is blocked)

If you can’t use GitHub or GitHub Pages at all:

1. **Build the site once locally**  
   Ensure data is generated and the static files are in one folder, e.g.:
   - Run: `python backend/generate_data.py`
   - Your deployable folder = project root (it already has `index.html`, `css/`, `js/`, `data/`).

2. **Go to [Netlify Drop](https://app.netlify.com/drop)** (no account required for a quick test; sign up for a permanent URL).

3. **Drag and drop** the whole project folder (the one that contains `index.html`, `css`, `js`, `data`) onto the page.

4. Netlify will give you a URL like `https://random-name-123.netlify.app`. You can later add a custom domain or a nicer Netlify subdomain from the dashboard.

No GitHub, no Actions, no build step on their side — they just serve your static files.

---

## Summary

| Method              | Needs GitHub Actions? | What you do                          |
|---------------------|------------------------|--------------------------------------|
| **GitHub Pages**    | No                     | Enable Pages from `gh-pages`, run `python deploy.py` when you want to update. |
| **Netlify Drop**    | No                     | Run `python backend/generate_data.py`, then drag the project folder to app.netlify.com/drop. |

For a shareable URL with minimal setup, use **Option 1** if you’re allowed to use GitHub and GitHub Pages; otherwise use **Option 2**.
