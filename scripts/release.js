import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = path.resolve(__dirname, '..');
const PACKAGE_JSON_PATH = path.join(WORKSPACE_DIR, 'package.json');
const CHANGELOG_PATH = path.join(WORKSPACE_DIR, 'CHANGELOG.md');
const REPO_SNAPSHOT_PATH = path.join(WORKSPACE_DIR, 'context/tech/REPO_SNAPSHOT.md');

// 命令行交互辅助函数
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans);
  }));
}

// 统一的 Shell 执行器
function runCommand(command, desc = '') {
  if (desc) console.log(`\n⚙️  ${desc}...`);
  try {
    return execSync(command, { cwd: WORKSPACE_DIR, encoding: 'utf8', stdio: 'inherit' });
  } catch (e) {
    console.error(`\n❌ Error executing command: "${command}"`);
    process.exit(1);
  }
}

async function startRelease() {
  console.log('\n=========================================');
  console.log('🚀 opencode-token-tracker Release Lifecycle');
  console.log('=========================================\n');

  // --- 1. 防御性检查 (Pre-flight Checks) ---
  console.log('🔍 Running pre-flight defensive checks...');
  
  // A. 分支校验
  const currentBranch = execSync('git branch --show-current', { cwd: WORKSPACE_DIR, encoding: 'utf8' }).trim();
  if (currentBranch !== 'dev') {
    console.error(`\n❌ Error: Current branch is "${currentBranch}". Releases must be prepared on the "dev" branch!`);
    console.log(`💡 Action: Please switch to dev: git checkout dev`);
    process.exit(1);
  }
  console.log('✅ Branch is "dev".');

  // B. 版本读取与 CHANGELOG 校验
  if (!fs.existsSync(PACKAGE_JSON_PATH)) {
    console.error(`\n❌ Error: package.json not found in root!`);
    process.exit(1);
  }
  
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  const version = pkg.version;
  console.log(`📦 Target version: v${version}`);

  if (!fs.existsSync(CHANGELOG_PATH)) {
    console.error(`\n❌ Error: CHANGELOG.md not found in root!`);
    process.exit(1);
  }

  const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const versionRegex = new RegExp(`##\\s*\\[${version.replace(/\./g, '\\.')}\\]`);
  if (!versionRegex.test(changelog)) {
    console.error(`\n❌ Error: No release entry found for v${version} in CHANGELOG.md!`);
    console.log(`💡 Action: Please add a "## [${version}] - YYYY-MM-DD" section to CHANGELOG.md before releasing.`);
    process.exit(1);
  }
  console.log(`✅ CHANGELOG.md contains release notes for v${version}.`);

  // --- 2. 编译与单元测试强验证 (Verify Suite) ---
  runCommand('pnpm build && pnpm test', 'Compiling TypeScript and running unit tests');
  console.log('✅ Compilation and all unit tests passed successfully.');

  // --- 3. 自动同步更新 Context 文档 (Auto-sync) ---
  if (fs.existsSync(REPO_SNAPSHOT_PATH)) {
    console.log(`\n📝 Syncing version and update date in context/tech/REPO_SNAPSHOT.md...`);
    let snapshot = fs.readFileSync(REPO_SNAPSHOT_PATH, 'utf8');
    const today = new Date().toISOString().split('T')[0];

    // A. 替换更新时间： 更新时间：YYYY-MM-DD
    snapshot = snapshot.replace(/更新时间：\d{4}-\d{2}-\d{2}/, `更新时间：${today}`);
    // B. 替换当前版本： - 当前版本：`X.Y.Z` 或 - 当前待发布版本：`X.Y.Z`
    snapshot = snapshot.replace(/- 当前(?:待发布)?版本：`\d+\.\d+\.\d+`/, `- 当前版本：\`${version}\``);

    fs.writeFileSync(REPO_SNAPSHOT_PATH, snapshot, 'utf8');
    console.log(`✅ REPO_SNAPSHOT.md updated successfully (Date: ${today}, Version: ${version}).`);
  } else {
    console.log('⚠️ Warning: context/tech/REPO_SNAPSHOT.md not found, skipping context sync.');
  }

  // --- 4. Git 暂存与 Commit 并推送至 dev ---
  console.log(`\n📁 Staging changes and committing on "dev" branch...`);
  runCommand('git add .');

  const hasChanges = execSync('git status --porcelain', { cwd: WORKSPACE_DIR, encoding: 'utf8' }).trim();
  if (hasChanges) {
    runCommand(`git commit -m "feat(release): prep v${version} release with automated assets"`);
    console.log(`✅ Staged modifications successfully committed on "dev".`);
  } else {
    console.log('ℹ️ No new changes to commit on "dev".');
  }

  runCommand('git push origin dev', 'Pushing dev branch to remote');
  console.log(`✅ Successfully pushed "dev" to origin/dev.`);

  // --- 5. GitHub CLI 校验与创建 Pull Request ---
  try {
    execSync('gh --version', { stdio: 'ignore' });
  } catch (e) {
    console.error(`\n❌ Error: GitHub CLI ("gh") is not installed or not in PATH!`);
    console.log(`💡 Action: Please install GitHub CLI and login: gh auth login`);
    process.exit(1);
  }

  console.log(`\n🚀 Creating Pull Request (dev -> main) via GitHub CLI...`);
  const prCreateCmd = `gh pr create --base main --head dev --title "chore(release): release v${version}" --body "Automated release PR for v${version} containing code updates, tests, and synced metadata."`;
  
  let prUrl = '';
  try {
    prUrl = execSync(prCreateCmd, { cwd: WORKSPACE_DIR, encoding: 'utf8' }).trim();
    console.log(`🎉 Pull Request created successfully!`);
    console.log(`👉 PR Link: ${prUrl}`);
  } catch (e) {
    console.log(`ℹ️ A Pull Request might already exist. Fetching existing PR...`);
    try {
      prUrl = execSync('gh pr list --base main --head dev --json url --jq ".[0].url"', { cwd: WORKSPACE_DIR, encoding: 'utf8' }).trim();
      if (prUrl) {
        console.log(`👉 Existing PR Link: ${prUrl}`);
      } else {
        throw e;
      }
    } catch (prErr) {
      console.error(`❌ Failed to create or retrieve PR. Please check your GitHub permissions.`);
      process.exit(1);
    }
  }

  // --- 6. 一键合并 PR 与本地 Main 同步 (Interactive Option) ---
  const mergeAns = await askQuestion(`\n❓ Would you like to merge this Pull Request and trigger v${version} release? (y/n): `);
  if (mergeAns.trim().toLowerCase() === 'y') {
    const prNumber = prUrl.split('/').pop();
    console.log(`\n🔗 Merging Pull Request #${prNumber}...`);
    runCommand(`gh pr merge ${prNumber} --merge`);
    console.log(`✅ Pull Request successfully merged on GitHub.`);
    
    console.log(`\n🔄 Syncing local "main" branch with remote...`);
    runCommand('git checkout main');
    runCommand('git fetch origin');
    runCommand('git reset --hard origin/main');
    console.log(`✅ Local "main" is now 100% in sync with origin/main.`);
    
    // --- 7. 打 Tag 并推送 (Tagging & Trigger) ---
    console.log(`\n🏷️  Tagging and triggering npm Release Workflow...`);
    
    // 自动清除本地/远程可能已有的冲突 Tag
    try {
      execSync(`git tag -d v${version}`, { cwd: WORKSPACE_DIR, stdio: 'ignore' });
      execSync(`git push origin --delete v${version}`, { cwd: WORKSPACE_DIR, stdio: 'ignore' }).catch(() => {});
    } catch(e) {}
    
    runCommand(`git tag v${version}`);
    runCommand(`git push origin v${version}`);
    
    console.log(`\n🎉 Release Tag v${version} has been successfully pushed!`);
    console.log(`🚀 GitHub Actions has taken over npm publishing. Watch workflow here:`);
    console.log(`👉 https://github.com/${pkg.repository?.url?.split('github.com/')[1]?.split('.git')[0]}/actions`);

    // --- 8. 陈旧 Feature 分支清理 (Cleanup) ---
    const cleanAns = await askQuestion(`\n❓ Would you like to clean up merged feature branches now? (y/n): `);
    if (cleanAns.trim().toLowerCase() === 'y') {
      console.log(`\n🧹 Auditing and cleaning up merged branches...`);
      try {
        const mergedBranchesRaw = execSync('git branch -r --merged main', { cwd: WORKSPACE_DIR, encoding: 'utf8' });
        const branchesToDelete = mergedBranchesRaw
          .split('\n')
          .map(b => b.trim())
          .filter(b => b.startsWith('origin/feature/'))
          .map(b => b.substring(7)); // remove "origin/"

        if (branchesToDelete.length === 0) {
          console.log(`✅ No merged feature branches found to clean up.`);
        } else {
          console.log(`Found ${branchesToDelete.length} merged branch(es) to clean up.`);
          for (const b of branchesToDelete) {
            console.log(`Deleting remote branch: ${b}`);
            execSync(`git push origin --delete ${b}`, { cwd: WORKSPACE_DIR, stdio: 'inherit' });
            execSync(`git branch -d ${b}`, { cwd: WORKSPACE_DIR, stdio: 'ignore' }).catch(() => {});
          }
          console.log(`✅ Cleanup completed successfully.`);
        }
      } catch (e) {
        console.log(`ℹ️ Branch cleanup encountered a non-fatal warning: ${e.message}`);
      }
    }
  } else {
    console.log(`\nℹ️ Flow paused. You can merge the PR manually on GitHub and run these commands to complete the release:`);
    console.log(`   git checkout main && git pull origin main && git tag v${version} && git push origin v${version}`);
  }

  console.log(`\n🏁 Release lifecycle script completed. Have a great day!\n`);
}

startRelease();
