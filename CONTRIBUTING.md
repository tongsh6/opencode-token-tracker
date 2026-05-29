# Contributing to opencode-token-tracker

## Branch Strategy

```
main     <- stable releases, published to npm
  |
dev      <- development branch, features merge here first
  |
feature/ <- feature branches (feature/xxx)
fix/     <- bug fix branches (fix/xxx)
```

### Workflow

1. **Feature Development**
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/my-feature
   # ... make changes ...
   git push origin feature/my-feature
   # Create PR to dev
   ```

2. **Bug Fixes**
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b fix/my-fix
   # ... make changes ...
   git push origin fix/my-fix
   # Create PR to dev
   ```

3. **Release to main**
   ```bash
   git checkout dev
   npm run release:check
   npm run release:prepare
   git push origin dev
   # Open or update the dev -> main PR
   ```

   After the release PR is merged and `main` is clean and synced:

   ```bash
   git checkout main
   git pull origin main
   npm run release:tag
   ```

   `release:tag` creates and pushes `vX.Y.Z` from `main`. The pushed tag triggers
   the GitHub Actions release workflow, which builds, tests, verifies that the tag
   matches `package.json`, publishes to npm, and creates the GitHub Release.

   Do not run `npm publish` manually for normal releases.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: update documentation
chore: maintenance tasks
refactor: code refactoring
test: add or update tests
```

## Development Setup

```bash
# Clone the repo
git clone https://github.com/tongsh6/opencode-token-tracker.git
cd opencode-token-tracker

# Install dependencies
npm install

# Build
npm run build

# Link for local testing
npm link
```

## Testing Locally

1. Link the package:
   ```bash
   npm link
   ```

2. Add to your OpenCode config (`~/.config/opencode/opencode.json`):
   ```json
   {
     "plugin": ["opencode-token-tracker"]
   }
   ```

3. Restart OpenCode

## Code Style

- TypeScript with strict mode
- ES2022 target
- ESM modules
- No external runtime dependencies (except @opencode-ai/plugin)

## Pull Request Guidelines

- Target the `dev` branch (not `main`)
- Include a clear description of changes
- Update README if adding new features
- Ensure build passes: `npm run build`
