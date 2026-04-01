$ErrorActionPreference='Stop'
$base='https://api.tradeaid.ink'
$ac='5056578090'
$u='at'+(Get-Date -Format 'MMddHHmm')+(Get-Random -Minimum 100 -Maximum 999)
$pw='Aa!23456Test'
Write-Output ('TRY_USERNAME='+$u)

function ApiBody($obj){ return ($obj | ConvertTo-Json -Compress) }
function ReadErr(){ if($_.Exception.Response){ $r=$_.Exception.Response; $sr=New-Object IO.StreamReader($r.GetResponseStream()); return ("status="+[int]$r.StatusCode+" body="+$sr.ReadToEnd()) } return $_ }

try { Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType 'application/json' -Body (ApiBody @{ username=$u; email="$u@example.com"; password=$pw; access_code=$ac }) | Out-Null; Write-Output 'REGISTER_OK' } catch { Write-Output ('REGISTER_ERR '+(ReadErr)); exit 1 }

try { $login=Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' -Body (ApiBody @{ username=$u; password=$pw; access_code=$ac }); $token=$login.access_token; if(-not $token){ throw 'missing token' }; Write-Output 'LOGIN_OK' } catch { Write-Output ('LOGIN_ERR '+(ReadErr)); exit 1 }

$h=@{ Authorization="Bearer $token" }

try { $wallet=Invoke-RestMethod -Method Post -Uri "$base/api/ai/wallets/create" -Headers $h -ContentType 'application/json' -Body '{}'; Write-Output ('WALLET_CREATE_OK has_wallet='+$wallet.wallet.has_wallet) } catch { Write-Output ('WALLET_CREATE_ERR '+(ReadErr)); exit 1 }

try { $cw=Invoke-RestMethod -Method Post -Uri "$base/api/doctor/connect-wallet" -Headers $h -ContentType 'application/json' -Body (ApiBody @{ use_existing_wallet=$true }); Write-Output ('DOCTOR_CONNECT_OK connected='+$cw.wallet_connected+' address='+$cw.wallet.address) } catch { Write-Output ('DOCTOR_CONNECT_ERR '+(ReadErr)); exit 1 }

Write-Output ('CREDS '+$u+'|'+$pw+'|'+$ac)
