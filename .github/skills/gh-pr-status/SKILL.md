---
name: gh-pr-status
description: PR status check — state, CI results, review decision, branch freshness. May offer to rebase or merge if behind.
---

> **Tool preference**: If GitHub MCP tools (e.g. `mcp_github_*`) are available, prefer them over `gh` CLI commands for API operations. Fall back to `gh` CLI when no equivalent MCP tool exists.

## Prerequisites

Verify `gh` is installed: `which gh` — if not found, tell user to run `brew install gh` and stop.

Run `gh auth status` — if not authenticated, tell user to run `gh auth login` and stop.

## Steps

1. **Get PR state:**
   ```bash
   gh pr view --json number,title,body,url,state,isDraft,reviewDecision,reviews,headRefName,baseRefName
   ```
   If no PR exists for the current branch, inform the user and stop.

2. **Get CI check results:**
   ```bash
   gh pr checks
   ```

3. **Summarize concisely:**
   - PR state: open / draft (if `isDraft` is true) / merged / closed
   - Review decision: approved / changes requested / pending / no reviewers (null for drafts)
   - CI checks: list each check with pass/fail/pending status
   - **Description freshness:** first ensure the base ref is up to date with `git fetch origin <baseRefName>`, then compare `git log --oneline origin/<baseRefName>..HEAD | wc -l` (using `baseRefName` from step 1) against the content/scope described in the PR body. If new commits have been added since the PR was created or last updated — especially changes you made during this session — note: "PR description may be stale (N commits on branch, description may not reflect recent changes)." Suggest using the **Update PR Description** section of the `gh-pr-create` skill to refresh it.

4. **Check branch freshness** against the base branch:
   ```bash
   owner_repo="$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')"
   gh api repos/${owner_repo}/compare/<base>...<head> --jq '{behind_by, ahead_by, status}'
   ```
   Use `baseRefName` and `headRefName` from step 1 for `<base>` and `<head>`.

   - If `behind_by` > 0, report: "Branch is **N commits behind** `<base>`."
   - Ask the user how they'd like to update:
     - **Merge** — `git fetch origin <base> && git merge origin/<base>` (creates a merge commit)
     - **Rebase** — `git fetch origin <base> && git rebase origin/<base>` (linear history, requires force push — **warn the user** that this will rewrite history and require `--force-with-lease`)
     - **Do nothing** — skip and continue
   - If the user chooses merge or rebase, **confirm before pushing**. Push with `git push` for merge or `git push --force-with-lease` for rebase.
   - If `behind_by` is 0, report: "Branch is up to date with `<base>`."

5. **If CI checks failed**, investigate using a layered approach (start concise, drill deeper only if needed):

   **Layer 1 — Job summary** (which jobs failed):
   ```bash
   gh run list --branch <branch> --json databaseId,name,conclusion --jq '.[] | select(.conclusion == "failure") | {id: .databaseId, name}'
   gh run view <run_id> --json jobs --jq '.jobs[] | select(.conclusion == "failure") | {id: .id, name}'
   ```

   **Layer 2 — Annotations** (concise error summaries, usually 1-5 lines).
   Note: Actions job IDs ≠ check-run IDs. Derive `owner/repo` and use the Jobs API to get the check-run URL:
   ```bash
   owner_repo="$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')"
   job_id=<job_id>  # .id from Layer 1 output
   check_run_url="$(gh api repos/${owner_repo}/actions/jobs/${job_id} --jq .check_run_url)"
   check_run_id="${check_run_url##*/}"
   gh api repos/${owner_repo}/check-runs/${check_run_id}/annotations --jq '.[] | {level: .annotation_level, message: .message}'
   ```

   **Layer 3 — Download and analyze** (if annotations lack detail):
   ```bash
   gh run view <run_id> --log-failed > /tmp/ci-log-<run_id>.txt
   wc -l /tmp/ci-log-<run_id>.txt
   ```
   Use a **subagent** (preferred) or file-reading tool to search the downloaded file for error patterns, read context around failures, and produce a structured summary. If those are unavailable, use `grep -n "error\|failure\|FAILED" /tmp/ci-log-<run_id>.txt | head -30` to locate key lines. Clean up with `rm /tmp/ci-log-<run_id>.txt` when done.

   **Never** dump full logs to terminal — they can be 200K+ lines.

   Always start at Layer 1 and only go deeper if the cause isn't clear.

6. **If changes requested:** mention that the `gh-pr-review` skill can be used to fetch and address review comments.

## Boundaries

- **Mostly read-only** — only modifies the branch if the user explicitly chooses merge or rebase in step 4
- **Never merge or close the PR** — provide the PR link for manual action
