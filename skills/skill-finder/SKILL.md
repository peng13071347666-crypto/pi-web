---
name: skill-finder
description: >
  Search, compare, and recommend skills from the skills.sh marketplace.
  Use when (1) user asks to find a skill for a specific task,
  (2) user wants to compare similar skills,
  (3) user asks "is there a skill for X",
  (4) user wants skill recommendations.
---

# Skill Finder

You have access to the **skills.sh** marketplace — a public registry of agent skills.

## When to use this skill

- User asks: "帮我找一个能做 X 的 skill"
- User asks: "有没有关于 Y 的 skill"
- User wants to compare skills: "A 和 B 哪个更好"
- User asks for recommendations: "推荐一个做 Z 的 skill"

## How to search the marketplace

Use the skills.sh HTTP API to search:

```bash
curl -s "https://skills.sh/api/search?q=<keyword>&limit=20"
```

The response is JSON:
```json
{
  "skills": [
    {
      "id": "slug",
      "name": "skill-name",
      "source": "owner/repo",
      "description": "What the skill does...",
      "installs": 1234
    }
  ]
}
```

## Workflow

1. **Search**: Query the API with relevant keywords (try multiple if needed)
2. **Analyze**: Read the descriptions, compare install counts, check relevance
3. **Recommend**: Present the top options with pros/cons to the user
4. **Install** (if user confirms): Run the install command

## Install commands

```bash
# Global install (available in all projects)
npx skills add <owner/repo@skill-name> -y --agent pi -g

# Project-level install (only in current project)
npx skills add <owner/repo@skill-name> -y --agent pi
```

## Comparison guidelines

When comparing skills, consider:
- **Install count**: Higher = more battle-tested
- **Description match**: How well it fits the user's need
- **Source reputation**: Known orgs/repos are more reliable
- **Scope**: Whether it overlaps with already-installed skills

## Important

- ALWAYS search the marketplace first before suggesting alternatives
- Try multiple keyword variations if first search yields poor results
- Present results in a clear comparison table when multiple options exist
- Ask user whether to install globally or per-project
