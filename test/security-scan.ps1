# 安全扫描：确认仓库里没有任何真实密钥
$r = "C:\Users\梁昀\Documents\deepseek-harness\default-workspace\lingyi-final\repo"

Write-Host "=== 精确扫描：真正的密钥值（不是变量名）===" -ForegroundColor Cyan
$patterns = @{
  'Tencent SecretId value'   = 'AKID[A-Za-z0-9]{16,}'
  'Tencent SecretKey 32char' = '["'']([A-Za-z0-9]{32})["'']'
  'DeepSeek key value'       = 'sk-[A-Za-z0-9]{20,}'
  'Bearer token value'       = 'Bearer\s+[A-Za-z0-9_\-\.]{20,}'
  'hardcoded assignment'     = '(?i)(secret_?id|secret_?key|api_?key|password)\s*[:=]\s*["''][^"''\s]{10,}["'']'
}
$found = 0
foreach ($k in $patterns.Keys) {
  $hits = Get-ChildItem -LiteralPath $r -Recurse -File -Force |
    Select-String -Pattern $patterns[$k] -ErrorAction SilentlyContinue
  if ($hits) {
    $found++
    Write-Host ("[{0}] HIT {1}:" -f $k, $hits.Count) -ForegroundColor Red
    $hits | Select-Object -First 6 | ForEach-Object {
      $line = $_.Line.Trim()
      if ($line.Length -gt 90) { $line = $line.Substring(0, 90) }
      Write-Host ("    {0} :{1}  {2}" -f $_.Path.Replace("$r\", ''), $_.LineNumber, $line)
    }
  } else {
    Write-Host ("[{0}] none OK" -f $k) -ForegroundColor Green
  }
}
Write-Host ""
if ($found -eq 0) { Write-Host "CONCLUSION: no real secret values in the repo" -ForegroundColor Green }
else { Write-Host "ATTENTION: $found pattern group(s) matched, review above" -ForegroundColor Red }

Write-Host ""
Write-Host "=== URLs appearing in shipped code (should be only libraries + placeholders) ===" -ForegroundColor Cyan
Get-ChildItem -LiteralPath $r -Recurse -File |
  Where-Object { $_.Extension -in '.js', '.html', '.json' } |
  Select-String -Pattern 'https?://[a-zA-Z0-9\.\-]+' -AllMatches |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique |
  Where-Object { $_ -notmatch 'github|w3\.org|jsdelivr|cdnjs|unpkg|fonts\.|fontawesome|schema|openxmlformats|mozilla' } |
  ForEach-Object { "  $_" }
