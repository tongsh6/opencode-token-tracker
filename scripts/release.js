import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(WORKSPACE_DIR, 'package.json');
const CHANGELOG_PATH = path.join(WORKSPACE_DIR, 'CHANGELOG.md');
const REPO_SNAPSHOT_PATH = path.join(WORKSPACE_DIR, 'context/tech/REPO_SNAPSHOT.md');
const RELEASE_FILES = [
  'context/tech/REPO_SNAPSHOT.md',
];

const mode = process.argv[2] ?? 'check';
const assumeYes = process.argv.includes('--yes');

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: WORKSPACE_DIR,
    encoding: 'utf8',
    stdio: options.stdio ?? 'inherit',
  });

  if (result.error) {
    fail(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    fail(stderr || `${command} ${args.join(' ')} exited with ${result.status}`);
  }

  return result.stdout?.trim() ?? '';
}

function output(command, args) {
  return run(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function readPackageJson() {
  if (!fs.existsSync(PACKAGE_JSON_PATH)) {
    fail('package.json not found');
  }

  return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

function getVersion() {
  const version = readPackageJson().version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`package.json version is not a supported semver release: ${version}`);
  }

  return version;
}

function getCurrentBranch() {
  return output('git', ['branch', '--show-current']);
}

function requireBranch(expected) {
  const currentBranch = getCurrentBranch();
  if (currentBranch !== expected) {
    fail(`current branch is "${currentBranch}". Expected "${expected}".`);
  }
}

function getPorcelainStatus() {
  return output('git', ['status', '--porcelain']);
}

function requireCleanWorktree() {
  const status = getPorcelainStatus();
  if (status) {
    fail(`working tree is not clean:\n${status}`);
  }
}

function verifyChangelog(version) {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    fail('CHANGELOG.md not found');
  }

  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s+-\\s+\\d{4}-\\d{2}-\\d{2})?\\s*$`, 'm');
  if (!heading.test(changelog)) {
    fail(`CHANGELOG.md does not contain a release section for ${version}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function verifyTagDoesNotExist(version) {
  const tag = `v${version}`;
  const localTag = output('git', ['tag', '--list', tag]);
  if (localTag) {
    fail(`local tag already exists: ${tag}`);
  }

  const remoteTag = output('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remoteTag) {
    fail(`remote tag already exists: ${tag}`);
  }
}

function syncRepoSnapshot(version) {
  if (!fs.existsSync(REPO_SNAPSHOT_PATH)) {
    fail('context/tech/REPO_SNAPSHOT.md not found');
  }

  const today = new Date().toISOString().slice(0, 10);
  const original = fs.readFileSync(REPO_SNAPSHOT_PATH, 'utf8');
  let updated = original
    .replace(/更新时间：\d{4}-\d{2}-\d{2}/, `更新时间：${today}`)
    .replace(/- 当前(?:待发布)?版本：`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?`/, `- 当前版本：\`${version}\``);

  if (updated === original) {
    console.log('context snapshot already matches release metadata.');
    return false;
  }

  fs.writeFileSync(REPO_SNAPSHOT_PATH, updated, 'utf8');
  console.log(`updated context/tech/REPO_SNAPSHOT.md to ${version} (${today}).`);
  return true;
}

function stageReleaseFiles() {
  run('git', ['add', ...RELEASE_FILES]);
}

function hasStagedChanges() {
  const diff = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd: WORKSPACE_DIR,
    encoding: 'utf8',
    stdio: 'ignore',
  });

  if (diff.status === 0) return false;
  if (diff.status === 1) return true;
  fail('failed to inspect staged release changes');
}

function ensureOnlyReleaseFilesChanged() {
  const status = getPorcelainStatus();
  if (!status) return;

  const unexpected = status
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter((file) => file && !RELEASE_FILES.includes(file));

  if (unexpected.length > 0) {
    fail(`unexpected working tree changes detected:\n${unexpected.join('\n')}`);
  }
}

function verifyMainMatchesOrigin() {
  run('git', ['fetch', 'origin', 'main']);
  const local = output('git', ['rev-parse', 'main']);
  const remote = output('git', ['rev-parse', 'origin/main']);
  if (local !== remote) {
    fail('local main does not match origin/main. Sync or inspect it before tagging.');
  }
}

async function confirm(question) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    fail(`confirmation required: rerun with --yes after reviewing this action. ${question}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question(`${question} [y/N] `, resolve);
  });
  rl.close();

  return answer.trim().toLowerCase() === 'y';
}

function runVerification() {
  run('npm', ['run', 'build']);
  run('npm', ['test']);
}

function printSummary(version) {
  console.log(`release target: v${version}`);
  console.log(`branch: ${getCurrentBranch()}`);
}

async function checkRelease() {
  requireBranch('dev');
  const version = getVersion();
  printSummary(version);
  verifyChangelog(version);
  verifyTagDoesNotExist(version);
  requireCleanWorktree();
  runVerification();
  console.log('\nrelease checks passed.');
}

async function prepareRelease() {
  requireBranch('dev');
  const version = getVersion();
  printSummary(version);
  verifyChangelog(version);
  verifyTagDoesNotExist(version);
  requireCleanWorktree();
  runVerification();

  syncRepoSnapshot(version);
  ensureOnlyReleaseFilesChanged();
  stageReleaseFiles();

  if (hasStagedChanges()) {
    run('git', ['commit', '-m', `chore(release): prepare v${version}`]);
    console.log('\nrelease metadata committed.');
  } else {
    console.log('\nno release metadata changes to commit.');
  }

  console.log(`next: git push origin dev, then open or update the dev -> main PR.`);
}

async function tagRelease() {
  requireBranch('main');
  const version = getVersion();
  printSummary(version);
  verifyChangelog(version);
  requireCleanWorktree();
  verifyMainMatchesOrigin();
  verifyTagDoesNotExist(version);
  runVerification();

  const tag = `v${version}`;
  const ok = await confirm(`Create and push ${tag} from current main?`);
  if (!ok) {
    console.log('tagging cancelled.');
    return;
  }

  run('git', ['tag', tag]);
  run('git', ['push', 'origin', tag]);
  console.log(`\npushed ${tag}. GitHub Actions release workflow will publish from the tag.`);
}

function printUsage() {
  console.log(`Usage:
  npm run release             # check only
  npm run release:check       # check only
  npm run release:prepare     # update and commit release metadata on dev
  npm run release:tag         # create and push vX.Y.Z from main
  npm run release:tag -- --yes
`);
}

switch (mode) {
  case 'check':
    await checkRelease();
    break;
  case 'prepare':
    await prepareRelease();
    break;
  case 'tag':
    await tagRelease();
    break;
  case 'help':
  case '--help':
  case '-h':
    printUsage();
    break;
  default:
    printUsage();
    fail(`unknown release mode: ${mode}`);
}
