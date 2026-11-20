// Which revision of a sibling repo (landing_page_build / landing_page_backend) a mining or check
// script reads — and a loud warning when that checkout is not what is DEPLOYED (origin/master):
// behind it, ahead of it (undeployed commits), or with no origin/master to compare against.
// A plain export (`git archive origin/master | tar -x`) carries its revision in a .rev file; that
// file wins, so an export placed inside some other repo is never reported as that repo.
//   sourceRev(dir, "landing_page_build")   → "master@3bb2aed1" | "export@3bb2aed1" | "?"
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export function sourceRev(dir, label = path.basename(dir)) {
  const revFile = path.join(dir, ".rev");
  if (fs.existsSync(revFile)) return `export@${fs.readFileSync(revFile, "utf8").trim()}`;
  const git = (cmd) => execSync(`git ${cmd}`, { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  let top;
  try {
    top = git("rev-parse --show-toplevel");
  } catch {
    return "?";
  }
  // a dir inside ANOTHER repo (git walks up) is not a checkout of the source
  if (fs.realpathSync(top) !== fs.realpathSync(dir)) {
    console.warn(`! ${label}: ${dir} is not a git checkout and has no .rev — revision unknown`);
    return "?";
  }
  const branch = git("rev-parse --abbrev-ref HEAD");
  const sha = git("rev-parse --short HEAD");
  let behind, ahead;
  try {
    behind = Number(git("rev-list --count HEAD..origin/master"));
    ahead = Number(git("rev-list --count origin/master..HEAD"));
  } catch {
    console.warn(`! ${label} has no origin/master to compare with — cannot tell whether it matches what is deployed`);
    return `${branch}@${sha} (no origin/master)`;
  }
  const off = [behind && `${behind} behind`, ahead && `${ahead} ahead of`].filter(Boolean).join(", ");
  if (off)
    console.warn(`! ${label} is ${off} origin/master — facts mined from it may not be what is deployed (git fetch first; mine from an export:\n    git -C ${dir} archive origin/master | tar -x -C <dir> && git -C ${dir} rev-parse --short origin/master > <dir>/.rev   (+ symlink node_modules))`);
  return `${branch}@${sha}${off ? ` (${off} origin/master)` : ""}`;
}
