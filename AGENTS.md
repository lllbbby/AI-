# Repository workflow

The user requested that all project changes be synchronized to https://github.com/lllbbby/AI-.

For each authorized change in this repository:

1. Keep source and documentation changes in this repository; never add `node_modules`, build output, installers, screenshots, local data, API keys, `.env` files, or credentials.
2. Check the current `main` ref before synchronizing. This workspace may not be a Git checkout, so use the connected GitHub repository tools to create a tree, a commit whose parent is the current `main`, then move the ref with an expected-SHA check. Never force-push or replace an advanced remote branch.
3. If a normal Git checkout and working credentials are available, a normal fast-forward commit and push is also acceptable. Run appropriate checks. Do not claim a sync succeeded unless the new files are visible on GitHub.
4. If the GitHub tools and Git credentials are unavailable, report that the source remains local and give any local commit SHA.

The repository is public and released under MIT. Keep the license and attribution intact.

