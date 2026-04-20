param(
  [string]$ProjectId = "2a91928e-16cb-4006-9409-4c40ff9d3ba8",
  [string]$Environment = "production",
  [string]$Service = "web",
  [string]$Window = "60m"
)

$ErrorActionPreference = "Stop"

function Get-Median {
  param([double[]]$Values)

  if (-not $Values -or $Values.Count -eq 0) {
    return $null
  }

  $sorted = $Values | Sort-Object
  $count = $sorted.Count
  if ($count % 2 -eq 1) {
    return [double]$sorted[[int][math]::Floor($count / 2)]
  }

  return [double](($sorted[$count / 2 - 1] + $sorted[$count / 2]) / 2.0)
}

Write-Host "Linking Railway service..."
railway link -p $ProjectId -e $Environment -s $Service | Out-Null

Write-Host "Fetching deployment logs ($Window)..."
$deployLogs = railway logs --service $Service --environment $Environment --since $Window 2>&1

Write-Host "Fetching HTTP logs ($Window)..."
$httpLogs = railway logs --service $Service --environment $Environment --http --since $Window --json 2>&1

$tickerRequests = ($deployLogs | Select-String "/api/doctor/ticker 200").Count
$tickerItems = ($deployLogs | Select-String '"id":"ticker_').Count

$ages = @()
foreach ($m in [regex]::Matches(($deployLogs -join "`n"), '"age_minutes":([0-9]+(?:\.[0-9]+)?)')) {
  $ages += [double]$m.Groups[1].Value
}

$freshnessScores = @()
foreach ($m in [regex]::Matches(($deployLogs -join "`n"), '"freshness_score":([0-9]+(?:\.[0-9]+)?)')) {
  $freshnessScores += [double]$m.Groups[1].Value
}

$eligibleCandidates = ($deployLogs | Select-String '"eligible":true').Count
$executionEvents = ($deployLogs | Select-String "trade_opened|buy_filled|sell_filled|execution").Count
$dbErrors = ($deployLogs | Select-String "ECONNRESET|Connection terminated unexpectedly|tick_failed").Count
$ingestionRefErrors = ($deployLogs | Select-String "scannerIngestionSnapshot is not defined").Count

$httpEntries = @()
foreach ($line in $httpLogs) {
  try {
    $obj = $line | ConvertFrom-Json
    if ($obj -and $obj.httpStatus) {
      $httpEntries += $obj
    }
  } catch {
    continue
  }
}

$httpTotal = $httpEntries.Count
$http5xx = ($httpEntries | Where-Object { [int]$_.httpStatus -ge 500 }).Count

$result = [ordered]@{
  window = $Window
  ticker_requests_200 = $tickerRequests
  ticker_items_detected = $tickerItems
  arrival_rate_per_min = if ($tickerRequests -gt 0) { [math]::Round($tickerRequests / ([int]($Window -replace "m$", "")), 3) } else { 0 }
  median_age_minutes = Get-Median -Values $ages
  median_freshness_score = Get-Median -Values $freshnessScores
  eligible_candidates_logged = $eligibleCandidates
  execution_related_log_lines = $executionEvents
  db_or_tick_errors = $dbErrors
  scanner_ingestion_reference_errors = $ingestionRefErrors
  http_total = $httpTotal
  http_5xx = $http5xx
  http_5xx_rate_pct = if ($httpTotal -gt 0) { [math]::Round(($http5xx * 100.0) / $httpTotal, 3) } else { 0 }
}

$result | ConvertTo-Json -Depth 5
