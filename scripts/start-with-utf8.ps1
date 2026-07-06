$ErrorActionPreference = "Stop"

[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:PYTHONIOENCODING = "utf-8"
$env:NODE_OPTIONS = (($env:NODE_OPTIONS, "--enable-source-maps") | Where-Object { $_ -and $_.Trim() -ne "" } | Select-Object -Unique) -join " "

if ($args.Count -eq 0) {
  Write-Host "UTF-8 console is ready. Run your command in this session."
  exit 0
}

$command = $args[0]
$commandArgs = @()
if ($args.Count -gt 1) {
  $commandArgs = $args[1..($args.Count - 1)]
}

& $command @commandArgs
exit $LASTEXITCODE
