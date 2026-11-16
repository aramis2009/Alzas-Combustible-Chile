# Contribution Workflow

`main` is the production branch. Keep it deployable and send changes through pull requests instead of pushing feature or bug-fix commits directly to it.

## Start a change

1. Update your local `main` with `git switch main` and `git pull --ff-only`.
2. Create one short-lived branch for one independently reviewable change. Branch names follow `type/NNN-short-description`, for example `feat/002-nearby-price-sorting` or `fix/003-stale-news-filter`. Use the next unused number across branch types.
3. For a bug, record the observed behavior and expected behavior. For a feature, keep the scope focused on the requested user outcome.

## Commit and open a pull request

- Commit coherent increments using the repository's Conventional Commit format: `type(scope): imperative summary`. Use English for commit messages.
- Run `npm run build` before opening or updating a pull request. The project does not currently define a test or lint script.
- Push the branch and open a pull request targeting `main`. Use an English title in the same Conventional Commit format, and describe the change, reason, and verification in English.
- Keep adding commits to the same branch while addressing feedback; each push updates the existing pull request and reruns the checks. Split unrelated work into separate branches and pull requests.
- For visual changes, inspect the Vercel Preview on desktop and mobile. For price, map, or news changes, verify the source attribution and empty or failure states that the change affects.

## Review and merge

Review the diff, confirm the build check passes, resolve review conversations, and inspect the Vercel Preview when available. Squash-merge the pull request so `main` receives one clear Conventional Commit, then delete the merged branch and update local `main`.

## Automated checks and deployments

GitHub Actions runs `npm ci` and `npm run build` for pull requests into `main` and pushes to `main`. No secrets are needed for this check. When the repository remains connected to Vercel, branch pushes and pull requests receive Preview Deployments; merging to `main` updates the production deployment.
