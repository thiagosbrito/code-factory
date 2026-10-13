$ErrorActionPreference = 'Stop'
$temporary = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$launcher = Join-Path $temporary 'code-factory-node-fixture.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $PSScriptRoot 'windows-node-fixture.cs'
& $compiler /nologo /target:exe /out:$launcher $source
if ($LASTEXITCODE -ne 0) { throw 'Windows fixture compilation failed' }
$env:CODE_FACTORY_WINDOWS_FIXTURE = $launcher
if ($env:GITHUB_ENV) {
    "CODE_FACTORY_WINDOWS_FIXTURE=$launcher" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
}
