import pc from 'picocolors';

export function helpText(): string {
  const b = pc.bold;
  const d = pc.dim;
  return `
  ${b('pubv')}  ${d('— graduate [Unreleased] into a release commit + tag')}

  ${b('Usage')}
    pubv ${d('[version]')} ${d('[flags]')}

  ${b('Arguments')}
    version             ${d('x.y.z[-tag]')} or one of ${d('major|minor|patch|pre')}
                        ${d('(omit to be prompted)')}

  ${b('Flags')}
    --dry-run           ${d('Show the plan; do not change anything')}
    -y, --yes           ${d('Skip all confirmations (for CI)')}
    --no-push           ${d('Do not push to the remote')}
    --no-tag            ${d('Do not create a tag')}
    --merge-request     ${d('Protected branch: open a release/<v> branch + MR (alias --mr)')}
    --tag-release       ${d('Post-merge: tag the latest changelog release on HEAD, push it')}
    --tag-prefix=v|none ${d('Override tag-prefix auto-detection')}
    --changelog=PATH    ${d('Path to the changelog file (default: CHANGELOG.md)')}
    --remote=NAME       ${d('Remote name (default: origin)')}
    --date=YYYY-MM-DD   ${d("Override today's date in the new heading")}
    -h, --help          ${d('Show this help')}
    -v, --version       ${d("Print pubv's version")}
`;
}
