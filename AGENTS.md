# Repository workflow

The user requested that all project changes be synchronized to https://github.com/lllbbby/AI-.

For each authorized change in this repository:

1. Keep source and documentation changes in this repository; never add `node_modules`, build output, installers, screenshots, local data, API keys, `.env` files, or credentials.
2. Run appropriate checks. Do not claim a sync succeeded unless the change is visible on GitHub.
3. Commit the change and push it to `origin/main` before finishing the work. Never force-push. If the remote has advanced, fetch and rebase/merge the user's commits before retrying.
4. If push fails due to connectivity or credentials, report that source remains local and give the exact unsynced commit SHA.

The repository is public and released under MIT. Keep the license and attribution intact.
