$ErrorActionPreference='Stop'
$base='https://api.tradeaid.ink'
$access='5056578090'
$u='autotest'+(Get-Random -Minimum 100000 -Maximum 999999)
$p='Aa#23456Test'
$e="$u@example.com"
Write-Output "USERNAME=$u"

function Show-ApiErr($prefix, $err) {
  if ($err.Exception.Response) {
    $r=$err.Exception.Response
    $sr=New-Object IO.StreamReader($r.GetResponseStream())
    Write-Output ("$prefix " + [int]$r.StatusCode + " " + $sr.ReadToEnd())
  } else {
    Write-Output ("$prefix " + $err)
  }
}

try {
  $registerBody=@{ username=$u; email=$e; password=$p; access_code=$access } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType 'application/json' -Body $registerBody | Out-Null
  Write-Output 'REGISTER_OK'
} catch { Show-ApiErr 'REGISTER_ERR' $_; exit 1 }

try {
  $loginBody=@{ username=$u; password=$p; access_code=$access } | ConvertTo-Json
  $login=Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' -Body $loginBody
  $token=$login.access_token
  if(-not $token){ throw 'No access token' }
  Write-Output 'LOGIN_OK'
} catch { Show-ApiErr 'LOGIN_ERR' $_; exit 1 }

$h=@{ Authorization="Bearer $token" }

try {
  $me=Invoke-RestMethod -Method Get -Uri "$base/api/auth/me" -Headers $h
  Write-Output ("ME_OK user_id=" + $me.user_id)
} catch { Show-ApiErr 'ME_ERR' $_; exit 1 }

try {
  $wallet=Invoke-RestMethod -Method Post -Uri "$base/api/ai/wallets/create" -Headers $h -ContentType 'application/json' -Body '{}'
  Write-Output ("WALLET_CREATE_OK has_wallet=" + $wallet.wallet.has_wallet)
  $pk = $wallet.bundle.private_keys_by_chain.solana
  if(-not $pk){ throw 'Missing solana private key in bundle' }
} catch { Show-ApiErr 'WALLET_CREATE_ERR' $_; exit 1 }

try {
  $cw1=Invoke-RestMethod -Method Post -Uri "$base/api/doctor/connect-wallet" -Headers $h -ContentType 'application/json' -Body (@{ use_existing_wallet=$true } | ConvertTo-Json)
  Write-Output ("DOCTOR_CONNECT_EXISTING_OK wallet_connected=" + $cw1.wallet_connected + " address=" + $cw1.wallet.address)
} catch { Show-ApiErr 'DOCTOR_CONNECT_EXISTING_ERR' $_; exit 1 }

try {
  $cw2=Invoke-RestMethod -Method Post -Uri "$base/api/doctor/connect-wallet" -Headers $h -ContentType 'application/json' -Body (@{ private_key=$pk } | ConvertTo-Json)
  Write-Output ("DOCTOR_CONNECT_PK_OK wallet_connected=" + $cw2.wallet_connected + " address=" + $cw2.wallet.address)
} catch { Show-ApiErr 'DOCTOR_CONNECT_PK_ERR' $_; exit 1 }

Write-Output ("TEST_CREDS username=" + $u + " password=" + $p + " access_code=" + $access)
