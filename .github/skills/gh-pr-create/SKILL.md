---
name: gh-pr-create
description: Create a GitHub PR from the current branch using `gh`. Supports draft PRs and converting drafts to ready. Never merges or closes PRs.
---

> **Tool preference**: If GitHub MCP tools (e.g. `mcp_github_*`) are available, prefer them over `gh` CLI commands for API operations. Fall back to `gh` CLI when no equivalent MCP tool exists.

## Prerequisites

Verify `gh` is installed: `which gh` — if not found, tell user to run `brew install gh` and stop.

Run `gh auth status` — if not authenticated, tell user to run `gh auth login` and stop.

## Conventions

- PR titles often follow the pattern `JIRA-TICKET [SERVICE-NAME]: Description` (e.g. `XVP-1234 [ESS]: Add retry logic`), but this is not strictly enforced. Generate a clear, concise title — if the user mentions a Jira ticket, include it.
- Base branch: `main` (unless user specifies otherwise)
- This skill never creates/switches branches or force-pushes
- This skill **never automatically commits or pushes** — always ask the user first

## Steps

Use `main` as the base branch unless the user specifies otherwise. Refer to this as `<base>` below.

1. Verify current branch is not `<base>`: `git branch --show-current` — if on `<base>`, tell the user to create and switch to a feature branch and stop.
2. Verify branch has commits ahead: `git log --oneline <base>..HEAD` — if empty, inform user and stop.
3. Check for uncommitted changes: `git status --short` — if there are uncommitted changes, list them and **ask the user** whether to proceed or commit first. Do not commit automatically.
4. Verify upstream is set: `git rev-parse --abbrev-ref --symbolic-full-name @{upstream}` — if this fails, tell the user to push with `-u` (e.g. `git push -u origin <branch>`) and stop.
5. Check for unpushed commits: `git log --oneline @{upstream}..HEAD` — if there are unpushed commits, list them and **ask the user** whether to push. Do not push automatically.
6. Check if PR already exists: `gh pr view --json url,state 2>/dev/null` — if a PR exists, show the URL and ask the user whether they want to **update the description**, **convert a draft to ready**, or **leave it as-is**. Do **not** continue to step 7 or attempt to create a new PR; instead, follow the relevant **Update PR Description** or **Convert Draft to Ready** section below (if requested) and then stop this create flow.
7. Gather context: `git fetch origin <base>`, then `git log --oneline origin/<base>..HEAD`, `git diff origin/<base> --stat`
8. Generate a clear, concise **title** and a **body**. If the user mentions a Jira ticket, include it in the title (e.g. `XVP-1234 [ESS]: Add retry logic`). The body should focus on **why** the change is being made — motivation, problem, context — not repeat implementation details visible in the diff. Be extremely concise; sacrifice grammar for brevity (fragments, shorthand, bullet dashes). If OpenSpec details are available from context, include them in the body.
9. Show title and body — **wait for user approval** before proceeding
10. Create the PR. Use `read -r -d ''` to load the body and run `gh` in a **single call** with clean output:
    ```bash
    read -r -d '' BODY <<'EOF' || true; gh pr create --title "<title>" --body "$BODY" --base <base>
    <body>
    EOF
    ```
    For a draft PR, add `--draft` to the `gh pr create` command.
    - If user hasn't specified, ask: "Draft or ready for review?"

Report: `✅ PR created: <url>` (or `✅ PR created (draft): <url>`)

## Update PR Description

Use this when the PR already exists and the description should be refreshed — either because the user requests it, or because you've made changes to the branch that the current description no longer reflects.

1. **Read the current PR title and body:**
   ```bash
   gh pr view --json number,title,body,headRefName,baseRefName
   ```
2. **Gather current context** (use `baseRefName` from step 1 as the base branch):
   ```bash
   git log --oneline <baseRefName>..HEAD
   git diff <baseRefName> --stat
   ```
   Also consider what you already know from the current session — files changed, features added, issues fixed, review comments addressed, etc.
3. **Regenerate title and body.** Use the original description as reference — incorporate parts that are still accurate, drop what's stale, add what's new.
   - **Title:** if the current title includes a Jira ticket (e.g. `XVP-1234 [ESS]: ...`), **keep the prefix**. Regenerate the rest of the title to reflect the current scope.
   - **Body:** regenerate completely. Focus on **why** — motivation, problem, context. Be extremely concise (fragments, shorthand, bullet dashes). If OpenSpec details are available, include them.
4. **Show the proposed changes** — display old vs new title/body so the user can compare.
5. **Wait for user approval** before applying.
6. **Apply the update:**
    ```bash
    read -r -d '' BODY <<'EOF' || true; gh pr edit --title "<new_title>" --body "$BODY"
    <new_body>
    EOF
    ```

Report: `✅ PR description updated: <url>`

## Convert Draft to Ready

If user wants to mark an existing draft ready: `gh pr ready`

Report: `✅ PR marked as ready for review: <url>`

## Boundaries

- **Never merge or close** — provide the PR link for manual action
- **Never force-push** — report errors and let user decide
