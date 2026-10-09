---
name: gh-pr-review
description: Address PR review comments, assign reviewers, request Copilot re-reviews. Never auto-commits, pushes, merges, or closes.
---

> **Tool preference**: If GitHub MCP tools (e.g. `mcp_github_*`) are available, prefer them over `gh` CLI commands for API operations. Fall back to `gh` CLI when no equivalent MCP tool exists.

## Prerequisites

Verify `gh` is installed: `which gh` — if not found, tell user to run `brew install gh` and stop.

Verify `gh auth status` before any operation — stop if not authenticated.

Verify `gh-pr-review` extension is installed: `gh pr-review --help`. If not found:
```bash
gh extension install agynio/gh-pr-review
```

Derive `-R owner/repo` from: `gh repo view --json owner,name --jq '.owner.login + "/" + .name'`.
Get PR number from: `gh pr view --json number --jq .number`.

## Address Review Comments

Fetch unresolved threads:
```bash
gh pr-review threads list --unresolved -R <owner/repo> <pr_number>
```
Returns a JSON array with `threadId`, `isResolved`, `path`, `line`, `isOutdated` for each thread.

For full comment bodies and context, use:
```bash
gh pr-review review view -R <owner/repo> --pr <pr_number> --unresolved --not_outdated
```

Present comments **one at a time**, in file order. For each unresolved comment:
1. Show the **file path and line number**
2. **Summarize** the comment (one sentence)
3. **Suggest a fix** — propose a specific code change or reply text
4. **Ask the user** to choose: fix (implement the change), reply (post a response), resolve (mark resolved without reply), or skip
5. Execute the user's choice, then move to the **next comment**

Do NOT batch comments or implement fixes until the user confirms each one individually.

**Reply.** Use `read -r -d ''` to load the reply and post in a single call:
```bash
read -r -d '' BODY <<'EOF' || true; gh pr-review comments reply <pr_number> -R <owner/repo> --thread-id <PRRT_...> --body "$BODY"
<reply_text>

---
*🤖 This comment was written by GitHub Copilot on behalf of the developer.*
EOF
```
Always append the signature line to every reply body.

**Resolve:**
```bash
gh pr-review threads resolve <pr_number> -R <owner/repo> --thread-id <PRRT_...>
```

After all comments addressed, **ask user** before committing/pushing.

## Assign Reviewers

`gh pr edit --add-reviewer <user1>,<user2>`

### Find Reviewers

If the user doesn't know the exact GitHub login, search assignable users by name or login:
```bash
owner_repo="$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')"
gh api graphql --paginate -f query='
  query($endCursor: String) {
    repository(owner: "'"${owner_repo%%/*}"'", name: "'"${owner_repo##*/}"'") {
      assignableUsers(first: 100, after: $endCursor) {
        nodes { login name }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
' --jq '.data.repository.assignableUsers.nodes[] | "\(.login)\t\(.name)"' \
  | grep -i "<search_term>"
```
Present matching users as a table and let the user pick. If the `ask_questions` tool is available, use it with `multiSelect: true` so the user can select one or more reviewers at once — use the login as the label and the name as the description. Otherwise, present a numbered list and ask the user to reply.

## Copilot Re-review

Remove and re-add to trigger fresh review:
```bash
gh pr edit --remove-reviewer "@copilot"
gh pr edit --add-reviewer "@copilot"
```

## Boundaries

- **Never auto-commits or pushes** — always ask user before committing or pushing changes
- **Never merge or close** — provide the PR link for manual action
