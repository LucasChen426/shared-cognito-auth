---
name: ctx7-docs
description: Query Context7 library documentation via CLI when MCP is unavailable. Uses a subagent to minimize context window usage.
---

## Prerequisites

`jq` and `curl` must be installed. If `jq` is missing: `brew install jq`.

## When to Use

- Context7 MCP tools are unavailable or disabled
- You need up-to-date library docs or code examples

Prefer Context7 MCP tools (`context7_resolve-library-id`, `context7_query-docs`) when available.

## Usage — Subagent Pattern (Preferred)

Always prefer a subagent to query docs. Raw API output is large; a subagent reads it in disposable context and returns a focused, cleaned reference document.

Launch `runSubagent` with a prompt like:

```
`.github/scripts/ctx7.sh` is a bash helper that queries the Context7 REST API and prints
library documentation as plain text to stdout.
You can run it multiple times with different topics to gather more context.

Run `.github/scripts/ctx7.sh docs "<library>" "<topic>"` in the terminal.
IMPORTANT: Do NOT redirect output to a file. Let the script print directly to
stdout so you can read the output inline.
If the results are insufficient, run additional queries with different topics.

Your job is to clean and deduplicate the raw documentation chunks — NOT to
summarize them. Merge overlapping content, remove duplicate snippets and APIDOC
scaffolding, and organize the result into a coherent document focused on:
<your specific task>.
Preserve all detail, code examples, and explanations from the original output.
Do not condense or omit information — only remove true duplicates and noise.
Collect all source/citation URLs from the output and include them at the end
under a "Sources" heading.
Return the cleaned documentation as your final message.
```

## Direct Usage (Fallback)

For quick, small lookups where context cost is acceptable:

```
.github/scripts/ctx7.sh docs <library> "<topic>"       # search + query in one shot
.github/scripts/ctx7.sh search <library>                # find library IDs
.github/scripts/ctx7.sh query <library_id> "<topic>"    # query with known ID
```

## Output

- `search`: library IDs, titles, descriptions to stdout
- `query`/`docs`: plain-text documentation + code examples to stdout
- Status messages to stderr

Exits with code 1 if no libraries match or the API returns an error.
