---
name: marketing
description: 'Generate marketing copy for Agent Board releases. Use when: writing changelog entries, VS Code Marketplace descriptions, social media posts (Twitter/X, LinkedIn, Bluesky), blog post drafts, feature highlight sections, or release announcements. Produces publish-ready copy that matches the project voice.'
argument-hint: 'What to write, e.g. "changelog for v0.5", "tweet for branch selection feature", "marketplace description update"'
---

# Marketing Copy Generator

## Voice & Tone

Agent Board copy follows these principles — enforce them in every output:

| Principle | Do | Don't |
|---|---|---|
| **Direct** | "Launch 10 agents in parallel." | "You can leverage our parallelism capabilities." |
| **Technical but approachable** | "Each session gets its own git worktree." | "Utilises isolated filesystem references." |
| **Action-oriented** | "Ship faster." | "Improve your productivity." |
| **Concise** | Short sentences, bullet points | Walls of text, marketing fluff |
| **Emoji-sparingly** | One per heading max, none in body | 🎉🚀💪🔥 every sentence |

Reference the existing [README](../../../README.md) and [CHANGELOG](../../../CHANGELOG.md) for the canonical voice.

## Procedure

### 1. Gather Context

Determine what the user wants to write. If not specified, ask:

- **Content type**: changelog entry, social post, marketplace listing, blog draft, feature highlight
- **Scope**: specific feature, full release, or project overview
- **Audience**: developers (technical), managers (value-focused), or general (mixed)

Collect feature details by reading recent changes:

- Run `git log --oneline -20` to find recent commits
- Read the `[Unreleased]` section of [CHANGELOG.md](../../../CHANGELOG.md)
- Check modified files for feature scope: `git diff --stat HEAD~10`

### 2. Generate Copy

Use the appropriate template from [./references/templates.md](./references/templates.md).

**Key rules:**
- Lead with the user benefit, not the implementation detail
- Include concrete numbers when possible ("10+ parallel sessions", "5 MCP tools")
- Always mention VS Code — this is an extension, not a standalone app
- Use the tagline "Manage tasks. Run agents. Ship faster." when appropriate
- Keep social posts under platform limits (280 chars for Twitter/X, 3000 for LinkedIn)

### 3. Review Checklist

Before delivering, verify:

- [ ] Matches the voice & tone table above
- [ ] No marketing buzzwords (leverage, synergy, cutting-edge, game-changer, revolutionize)
- [ ] Factually accurate — features mentioned actually exist in the codebase
- [ ] Includes a call-to-action (install link, repo link, or "try it" instruction)
- [ ] Platform-appropriate length and formatting
- [ ] Code snippets or commands are correct and tested

### 4. Deliver

Present the copy with:
- The raw text (ready to paste)
- A note on which platform/format it targets
- Any suggested images or screenshots (reference existing `media/` assets)
