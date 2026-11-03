# Initial push recovery

The bootstrap can commit locally without GitHub credentials. A successful connector profile lookup does not authenticate local Git or grant a repository-creation tool. Do not treat a 404 on a private repository as proof that it does not exist; verify with an authenticated GitHub CLI before creating anything.

Install the GitHub CLI using your platform's normal installation method, then:

```bash
gh auth login --hostname github.com --git-protocol https
gh auth setup-git
gh api user --jq .login
```

Verify that the account is the intended owner (connector during bootstrap reported `Coder909-byte`). Check for an existing repository:

```bash
gh repo view Coder909-byte/developer-intelligence --json nameWithOwner,url,isPrivate
```

If it exists and is the intended private repository, inspect its branches/history before attaching it. Do not overwrite unrelated history. For an empty intended repository, add origin only if it is absent:

```bash
git remote -v
git remote add origin https://github.com/Coder909-byte/developer-intelligence.git
git push -u origin main
```

If authenticated lookup confirms no such repository exists (rather than a permissions/network failure), create the requested private repository and push the existing local commit:

```bash
gh repo create Coder909-byte/developer-intelligence --private --source=. --remote=origin --push
```

Then confirm Git, not just CLI output:

```bash
git fetch origin
git rev-parse main
git rev-parse origin/main
git ls-remote --heads origin main
```

Only after successful initial push should Developer 1 run `git switch -c feat/core-platform`. Teammate branches are documented in their handoffs. Never force-push. If the intended remote is not empty, review and integrate its history separately.
