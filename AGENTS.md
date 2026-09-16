# Personal Agent Instructions

## Commit & Branch Conventions

Always use Conventional Commits v1.0.0 for commit messages, branch names, and related versioning

### Requirements
- commit messages must follow the Conventional Commits format: `<type>[optional scope]: <description>`
  - types: feat, fix, docs, style, refactor, perf, test, chore, etc
  - use imperative mood, lowercase description, no period at end
  - include breaking change indicator `!` or `BREAKING CHANGE:` footer when applicable
- use a second `-m` argument for `git commit` for more details
  - the body message should include the ticket number as the last line of the body
  - the ticket reference must be the final line of the second commit message body
- do not use branches, commit straight to `main`
- never use ad-hoc or free-form messages
  - always validate against https://www.conventionalcommits.org/en/v1.0.0/
