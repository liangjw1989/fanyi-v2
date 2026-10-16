# make-repo.ps1 — 生成"可直接上传 GitHub"的干净目录
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\make-repo.ps1              # 输出到 .\repo\
#   powershell -ExecutionPolicy Bypass -File .\make-repo.ps1 -Out D:\lingyi-repo
#
# 会按 .gitignore 规则只复制"该上传"的文件，并打印清单与体积。
# 运行前请先执行 node build.js，确保 dist\index.html 是最新构建。

param(
  [string]$Source = $PSScriptRoot,
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
if (-not $Out) { $Out = Join-Path $Source 'repo' }
$Out = [System.IO.Path]::GetFullPath($Out)

Write-Host "== 生成可上传目录 ==" -ForegroundColor Cyan
Write-Host "来源: $Source"
Write-Host "输出: $Out"

if (-not (Test-Path -LiteralPath (Join-Path $Source 'dist\index.html'))) {
  throw "缺少 dist\index.html，请先运行：node build.js"
}
if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Out | Out-Null

# 需要上传的路径（相对来源目录）
$include = @(
  'README.md',
  'LICENSE',
  'NOTICE.md',
  'config.js',
  'docs',
  'deploy',
  '.gitattributes',
  'upload-to-github.bat',
  'push-to-github.bat',
  'install-git.bat',
  'get-git-from-mirror.bat',
  'install-git-local.bat',
  'check-network.bat',
  'setup-github-ssh.bat',
  'upload-to-gitee.bat',
  'check-github-channel.bat',
  '.gitignore',
  'dist\index.html',          # 单文件版应用（构建产物，可直接部署到 GitHub Pages）
  'vendor',                   # 本地第三方库（docx 等），保证离线可用
  'app',
  'src',
  'build.js',
  'run-tests.js',
  'make-repo.ps1',
  'demo-docx.js',
  'test'
)

# 明确排除（多一层保险，即使 .gitignore 写漏也不会带出去）
$excludePatterns = @(
  'repo', '.git', 'dist\index.debug.html', 'dist\src', '演示', '_backup-*',
  'index.txt', 'vfs_fonts.js', '思源vfs_fonts.js',
  'test\out', 'test\samples\sample1.docx', 'test\samples\sample1.doc', 'test\samples\sample2.doc',
  'test\samples\sample_pdf_1p.pdf', 'test\samples\sample1.mammoth-like.html',
  'test\samples\sample1.docx-inspect.json', 'test\samples\twocol.pdfjs.json',
  'test\samples\paper1.pdfjs.json', 'test\samples\paper2.pdfjs.json',
  'test\samples\twocol.pdf', 'test\samples\paper1.pdf', 'test\samples\paper2.pdf',
  'test\samples\oncol.pdf', '*.keep'
)

function Test-Excluded([string]$rel) {
  foreach ($p in $excludePatterns) {
    if ($rel -like $p -or $rel -like "$p\*" -or (Split-Path $rel -Leaf) -like $p) { return $true }
  }
  return $false
}

$script:copied = @()
function Copy-Tree([string]$src, [string]$base) {
  foreach ($item in Get-ChildItem -LiteralPath $src -Force) {
    $rel = if ($base) { Join-Path $base $item.Name } else { $item.Name }
    if (Test-Excluded $rel) { continue }
    $dst = Join-Path $Out $rel
    if ($item.PSIsContainer) {
      New-Item -ItemType Directory -Force -Path $dst | Out-Null
      Copy-Tree $item.FullName $rel
    } else {
      New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
      Copy-Item -LiteralPath $item.FullName -Destination $dst -Force
      $script:copied += [pscustomobject]@{ 文件 = $rel; KB = [math]::Round($item.Length / 1KB, 1) }
    }
  }
}

foreach ($inc in $include) {
  $p = Join-Path $Source $inc
  if (-not (Test-Path -LiteralPath $p)) { Write-Host "  （跳过，不存在）$inc" -ForegroundColor DarkGray; continue }
  $item = Get-Item -LiteralPath $p
  if ($item.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path (Join-Path $Out $inc) | Out-Null
    Copy-Tree $item.FullName $inc
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path (Join-Path $Out $inc) -Parent) | Out-Null
    Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $Out $inc) -Force
    $script:copied += [pscustomobject]@{ 文件 = $inc; KB = [math]::Round($item.Length / 1KB, 1) }
  }
}

# 单文件版在仓库根目录也放一份，方便直接开 GitHub Pages
$distHtml = Join-Path $Out 'dist\index.html'
if (Test-Path -LiteralPath $distHtml) {
  Copy-Item -LiteralPath $distHtml -Destination (Join-Path $Out 'index.html') -Force
  $script:copied += [pscustomobject]@{ 文件 = 'index.html'; KB = [math]::Round((Get-Item -LiteralPath $distHtml).Length / 1KB, 1) }
}

Write-Host "`n将上传的文件：" -ForegroundColor Cyan
$script:copied | Sort-Object 文件 | Format-Table -AutoSize
$sum = ($script:copied | Measure-Object KB -Sum).Sum
Write-Host ("共 {0} 个文件，合计 {1:N1} KB" -f $script:copied.Count, $sum) -ForegroundColor Green
Write-Host "`n下一步：" -ForegroundColor Cyan
Write-Host "  cd `"$Out`""
Write-Host "  git init"
Write-Host "  git add ."
Write-Host "  git commit -m `"feat: 保版式文档翻译 v2.1（术语库 + 符号保护 + 翻译记忆）`""
Write-Host "  git branch -M main"
Write-Host "  git remote add origin https://github.com/<你的用户名>/<仓库名>.git"
Write-Host "  git push -u origin main"
Write-Host "`n提示：仓库 Settings → Pages 选择 main 分支根目录，即可用 GitHub Pages 直接打开应用。" -ForegroundColor DarkGray
