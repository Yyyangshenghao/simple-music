param([int]$Port = 38927)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifest = Join-Path $root 'update-manifest.json'
$setup = Join-Path $root 'Simple-Music-2.7.0-TEST-Setup.exe'
if (!(Test-Path -LiteralPath $manifest) -or !(Test-Path -LiteralPath $setup)) { throw 'Test kit is incomplete.' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Output "Local update source: http://127.0.0.1:$Port/update.json"
$expires = [DateTime]::UtcNow.AddHours(2)
try {
  while ([DateTime]::UtcNow -lt $expires) {
    if (!$listener.Pending()) { Start-Sleep -Milliseconds 100; continue }
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 5000
    $client.SendTimeout = 30000
    $stream = $client.GetStream()
    try {
      # Read a bounded HTTP header without buffering any body or accepting uploads.
      $header = [Collections.Generic.List[byte]]::new()
      while ($header.Count -lt 8192) {
        $next = $stream.ReadByte()
        if ($next -lt 0) { break }
        $header.Add([byte]$next)
        $n = $header.Count
        if ($n -ge 4 -and $header[$n-4] -eq 13 -and $header[$n-3] -eq 10 -and $header[$n-2] -eq 13 -and $header[$n-1] -eq 10) { break }
      }
      $request = [Text.Encoding]::ASCII.GetString($header.ToArray()).Split("`r`n")[0].Split(' ')
      $file = $null
      $type = 'text/plain; charset=utf-8'
      $status = '404 Not Found'
      $body = [Text.Encoding]::UTF8.GetBytes('Not found')
      if ($request.Count -ge 2 -and $request[0] -eq 'GET') {
        if ($request[1] -eq '/health') {
          $status = '200 OK'
          $body = [Text.Encoding]::UTF8.GetBytes('simple-music-update-test-v1')
        } elseif ($request[1] -eq '/update.json') {
          $status = '200 OK'; $file = $manifest; $type = 'application/json; charset=utf-8'
        } elseif ($request[1] -eq '/Simple-Music-2.7.0-TEST-Setup.exe') {
          $status = '200 OK'; $file = $setup; $type = 'application/octet-stream'
        } elseif ($request[1] -eq '/stop') {
          $status = '200 OK'; $body = [Text.Encoding]::UTF8.GetBytes('Stopped'); $expires = [DateTime]::UtcNow
        }
      }
      $length = if ($file) { (Get-Item -LiteralPath $file).Length } else { $body.Length }
      $response = [Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n")
      $stream.Write($response, 0, $response.Length)
      if ($file) {
        $inputFile = [IO.File]::OpenRead($file)
        try { $inputFile.CopyTo($stream) } finally { $inputFile.Dispose() }
      } else { $stream.Write($body, 0, $body.Length) }
      $stream.Flush()
    } catch { Write-Warning $_.Exception.Message }
    finally { $stream.Dispose(); $client.Dispose() }
  }
} finally { $listener.Stop() }
