# Sync Substack content locally and push to GitHub.
# Run this from the repo root after publishing a new post:
#
#   .\refresh-substack.ps1
#
# To preview changes without committing, use:
#
#   .\refresh-substack.ps1 -DryRun

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

Write-Host "Syncing Substack content..." -ForegroundColor Cyan

python scripts/sync_substack_content.py `
    --diagnostics `
    --retries 3 `
    --timeout 30 `
    --source-order posts,feed-web,archive `
    --min-public-posts 1 `
    --merge-baseline

if ($LASTEXITCODE -ne 0) {
    Write-Host "Sync failed. Aborting." -ForegroundColor Red
    exit 1
}

$changed = git diff --quiet -- data/writings.json data/works-substack.json
if ($LASTEXITCODE -eq 0) {
    Write-Host "No content changes - already up to date." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
git diff --stat -- data/writings.json data/works-substack.json

if ($DryRun) {
    Write-Host ""
    Write-Host "[dry-run] Changes detected but not committed." -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Committing and pushing..." -ForegroundColor Cyan
git add data/writings.json data/works-substack.json
git commit -m "chore: refresh Substack content"
git push

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
