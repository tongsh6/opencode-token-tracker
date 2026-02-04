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
   - Merge dev -> main via PR
   - Tag the release: `git tag v1.x.x`
   - Publish to npm: `npm publish`

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
