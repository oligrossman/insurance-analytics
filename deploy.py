#!/usr/bin/env python3
"""
Simple deployment script for GitHub Pages.

This script:
1. Generates fresh data using the Python backend
2. Copies all necessary files to a gh-pages branch
3. Commits and pushes to GitHub

Usage:
    python3 deploy.py

Best Practices:
    - Uses subprocess for git operations (clear, traceable)
    - Checks for uncommitted changes before deploying
    - Creates a clean gh-pages branch with only deployment files
    - Excludes backend code and requirements.txt from deployment
"""

import subprocess
import sys
import shutil
import tempfile
from pathlib import Path

# Files/directories to include in deployment
DEPLOY_FILES = [
    "index.html",
    "css/",
    "js/",
    "data/",
]

# Files/directories to exclude
EXCLUDE = [
    ".git",
    ".github",
    "backend/",
    "requirements.txt",
    "deploy.py",
    "README.md",
    ".gitignore",
]


def run_cmd(cmd, check=True, capture_output=False):
    """Run a shell command and return the result."""
    result = subprocess.run(
        cmd, shell=True, check=check, capture_output=capture_output, text=True
    )
    return result.stdout.strip() if capture_output else None


def check_clean_working_tree():
    """Ensure working tree is clean before deploying (allow data changes)."""
    status = run_cmd("git status --porcelain", capture_output=True)
    if status:
        # Allow data/analytics.json changes (they'll be committed)
        lines = status.split('\n')
        other_changes = [l for l in lines if not l.strip().endswith('data/analytics.json')]
        if other_changes:
            print("❌ Error: You have uncommitted changes (excluding data/analytics.json).")
            print("Please commit or stash them before deploying.")
            sys.exit(1)


def generate_data():
    """Run the data generation script."""
    print("📊 Generating data...")
    try:
        run_cmd("python3 backend/generate_data.py")
        print("✓ Data generated")
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to generate data: {e}")
        sys.exit(1)


def deploy_to_gh_pages():
    """Deploy files to gh-pages branch."""
    print("\n🚀 Deploying to gh-pages branch...")

    # Get current branch
    current_branch = run_cmd("git rev-parse --abbrev-ref HEAD", capture_output=True)
    repo_root = Path(__file__).parent

    # Create temp directory and copy files from main branch
    import shutil
    import tempfile
    temp_dir = Path(tempfile.mkdtemp())
    print(f"📦 Copying files to temp directory...")
    
    for item in DEPLOY_FILES:
        src = repo_root / item
        if src.exists():
            dst = temp_dir / item
            if src.is_dir():
                shutil.copytree(src, dst, dirs_exist_ok=True)
            else:
                shutil.copy2(src, dst)
    
    # Checkout or create gh-pages branch
    # First, delete local gh-pages if it exists
    branches = run_cmd("git branch", capture_output=True)
    if "gh-pages" in branches:
        run_cmd("git branch -D gh-pages", check=False)
    
    # Try to checkout from remote
    try:
        run_cmd("git checkout -b gh-pages origin/gh-pages")
        print("✓ Checked out gh-pages from remote")
    except subprocess.CalledProcessError:
        # No remote, create orphan branch
        run_cmd("git checkout --orphan gh-pages")
        print("✓ Created new gh-pages branch")

    # Remove all files
    run_cmd("git rm -rf .", check=False)

    # Copy files from temp directory
    print("📋 Copying files to gh-pages...")
    for item in DEPLOY_FILES:
        src = temp_dir / item
        if src.exists():
            if src.is_dir():
                shutil.copytree(src, item, dirs_exist_ok=True)
            else:
                shutil.copy2(src, item)

    # Clean up temp directory
    shutil.rmtree(temp_dir)

    # Stage all files
    run_cmd("git add -A")

    # Commit
    commit_msg = f"Deploy: Update from {current_branch}"
    run_cmd(f'git commit -m "{commit_msg}"', check=False)

    # Push
    print("📤 Pushing to GitHub...")
    run_cmd("git push origin gh-pages --force")
    print("✓ Pushed to GitHub")

    # Switch back to original branch
    run_cmd(f"git checkout {current_branch}")
    print(f"✓ Switched back to {current_branch} branch")

    print("\n✅ Deployment complete!")
    print("Your site should be live at:")
    print("   https://oligrossman.github.io/insurance-analytics/")


if __name__ == "__main__":
    print("=" * 60)
    print("GitHub Pages Deployment Script")
    print("=" * 60)

    check_clean_working_tree()
    generate_data()
    deploy_to_gh_pages()
