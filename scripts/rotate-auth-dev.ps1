$ErrorActionPreference = 'Stop'
$stage = 'preflight'
$connection = $null
$transaction = $null
$replaced = $false
$committed = $false
$privateFile = Join-Path $env:LOCALAPPDATA 'GestorTareas\A1\auth-dev-credentials.json'
$directory = Split-Path -Parent $privateFile
$tempFile = Join-Path $directory ('auth-rotate-' + [guid]::NewGuid().ToString('N') + '.json')
$backupFile = Join-Path $directory ('auth-backup-' + [guid]::NewGuid().ToString('N') + '.json')

try {
  if (-not (Test-Path -LiteralPath $privateFile)) { throw 'private file missing' }
  $data = Get-Content -LiteralPath $privateFile -Raw | ConvertFrom-Json
  $accounts = @($data.accounts)
  $expected = @(
    @{ correo = 'docente.a1@example.test'; rol = 'DOCENTE'; estado = $true },
    @{ correo = 'alumno.a1@example.test'; rol = 'ALUMNO'; estado = $true },
    @{ correo = 'alumno.inactivo.a1@example.test'; rol = 'ALUMNO'; estado = $false }
  )
  if ($accounts.Count -ne 3) { throw 'account count mismatch' }
  $oldHashes = @{}
  $newPasswords = @{}
  for ($index = 0; $index -lt 3; $index++) {
    $account = $accounts[$index]
    if ($account.correo -ne $expected[$index].correo -or
        $account.rol -ne $expected[$index].rol -or
        [bool]$account.estado -ne $expected[$index].estado -or
        -not ([string]$account.hash).StartsWith('$argon2id$v=19$m=19456,p=1,t=2$')) {
      throw 'private account mismatch'
    }
    $oldHashes[[string]$account.correo] = [string]$account.hash
    $secure = Read-Host "Nueva contraseña de $($account.correo)" -AsSecureString
    $password = [System.Net.NetworkCredential]::new('', $secure).Password
    if ($password.Length -lt 10 -or $password.Length -gt 256) { throw 'password length must be 10 to 256' }
    $newPasswords[[string]$account.correo] = $password
  }
  if (@($newPasswords.Values | Select-Object -Unique).Count -ne 3) { throw 'passwords must differ' }

  $stage = 'hashing'
  $nodeCode = @'
const fs = require('fs');
const { PasswordHasherService } = require('./dist/modules/auth/password-hasher.service');
(async () => {
  const inputs = JSON.parse(fs.readFileSync(0, 'utf8'));
  const hasher = new PasswordHasherService();
  const hashes = [];
  for (const input of inputs) hashes.push({ correo: input.correo, hash: await hasher.hash(input.password) });
  process.stdout.write(JSON.stringify(hashes));
})().catch(() => process.exit(1));
'@
  $inputs = @($accounts | ForEach-Object { @{ correo = [string]$_.correo; password = $newPasswords[[string]$_.correo] } })
  $hashJson = (ConvertTo-Json -InputObject $inputs -Compress) | node -e $nodeCode
  if ($LASTEXITCODE -ne 0) { throw 'hashing failed' }
  $hashes = @($hashJson | ConvertFrom-Json)
  if ($hashes.Count -ne 3) { throw 'hash count mismatch' }
  $newHashes = @{}
  foreach ($item in $hashes) {
    if (-not ([string]$item.hash).StartsWith('$argon2id$v=19$m=19456,p=1,t=2$')) {
      throw 'hash parameters mismatch'
    }
    $newHashes[[string]$item.correo] = [string]$item.hash
  }

  $stage = 'destination'
  $connection = [System.Data.SqlClient.SqlConnection]::new(
    'Server=tcp:localhost,1433;Database=GestorTareasDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=5'
  )
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandText = @'
SELECT CONVERT(nvarchar(128), SERVERPROPERTY('MachineName')) AS machine,
       CONVERT(nvarchar(128), SERVERPROPERTY('InstanceName')) AS instance,
       DB_NAME() AS database_name, IS_SRVROLEMEMBER('sysadmin') AS admin;
'@
  $reader = $command.ExecuteReader()
  $null = $reader.Read()
  $valid = [string]$reader['machine'] -eq $env:COMPUTERNAME -and
    [string]$reader['instance'] -eq 'MSSQLSERVER03' -and
    [string]$reader['database_name'] -eq 'GestorTareasDB' -and
    [int]$reader['admin'] -eq 1
  $reader.Close()
  if (-not $valid) { throw 'destination mismatch' }

  $stage = 'transaction'
  $transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
  foreach ($account in $accounts) {
    $command = $connection.CreateCommand()
    $command.Transaction = $transaction
    $command.CommandText = @'
SELECT u.IdUsuario, u.Nombres, u.Apellidos, u.ContrasenaHash, u.Estado,
       CASE WHEN d.IdDocente IS NULL THEN 0 ELSE 1 END AS EsDocente,
       CASE WHEN a.IdAlumno IS NULL THEN 0 ELSE 1 END AS EsAlumno
FROM dbo.Usuario AS u WITH (UPDLOCK, HOLDLOCK)
LEFT JOIN dbo.Docente AS d ON d.IdDocente = u.IdUsuario
LEFT JOIN dbo.Alumno AS a ON a.IdAlumno = u.IdUsuario
WHERE u.Correo = @correo;
'@
    $null = $command.Parameters.Add('@correo', [System.Data.SqlDbType]::NVarChar, 150)
    $command.Parameters['@correo'].Value = [string]$account.correo
    $reader = $command.ExecuteReader()
    $exists = $reader.Read()
    if (-not $exists) { $reader.Close(); throw 'account missing' }
    $id = [int]$reader['IdUsuario']
    $matches = [string]$reader['Nombres'] -ceq [string]$account.nombres -and
      [string]$reader['Apellidos'] -ceq [string]$account.apellidos -and
      [string]$reader['ContrasenaHash'] -ceq $oldHashes[[string]$account.correo] -and
      [bool]$reader['Estado'] -eq [bool]$account.estado -and
      ([int]$reader['EsDocente'] -eq 1) -eq ($account.rol -eq 'DOCENTE') -and
      ([int]$reader['EsAlumno'] -eq 1) -eq ($account.rol -eq 'ALUMNO')
    $reader.Close()
    if (-not $matches) { throw 'account conflict' }

    $command = $connection.CreateCommand()
    $command.Transaction = $transaction
    $command.CommandText = @'
UPDATE dbo.Usuario SET ContrasenaHash = @newHash
WHERE IdUsuario = @id AND ContrasenaHash = @oldHash;
'@
    $null = $command.Parameters.Add('@id', [System.Data.SqlDbType]::Int)
    $command.Parameters['@id'].Value = $id
    $null = $command.Parameters.Add('@oldHash', [System.Data.SqlDbType]::NVarChar, 255)
    $command.Parameters['@oldHash'].Value = $oldHashes[[string]$account.correo]
    $null = $command.Parameters.Add('@newHash', [System.Data.SqlDbType]::NVarChar, 255)
    $command.Parameters['@newHash'].Value = $newHashes[[string]$account.correo]
    if ($command.ExecuteNonQuery() -ne 1) { throw 'update conflict' }
    $account.password = $newPasswords[[string]$account.correo]
    $account.hash = $newHashes[[string]$account.correo]
  }

  $stage = 'private file'
  $oldAcl = Get-Acl -LiteralPath $privateFile
  [System.IO.File]::WriteAllText($tempFile, (ConvertTo-Json -InputObject $data -Depth 5))
  Set-Acl -LiteralPath $tempFile -AclObject $oldAcl
  [System.IO.File]::Replace($tempFile, $privateFile, $backupFile)
  $replaced = $true
  if (-not (Get-Acl -LiteralPath $privateFile).AreAccessRulesProtected) { throw 'private ACL mismatch' }

  $stage = 'commit'
  $transaction.Commit()
  $transaction = $null
  $committed = $true
  'ROTATED_ACCOUNTS=3 SQL_COMMITTED=true PRIVATE_FILE_UPDATED=true'
} catch {
  if ($transaction) { try { $transaction.Rollback() } catch {} }
  if ($replaced -and -not $committed -and (Test-Path -LiteralPath $backupFile)) {
    try { [System.IO.File]::Replace($backupFile, $privateFile, $null) } catch {}
  }
  'FAILED_STAGE=' + $stage
  exit 1
} finally {
  if ($connection) { $connection.Dispose() }
  if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile }
  if ($committed -and (Test-Path -LiteralPath $backupFile)) { Remove-Item -LiteralPath $backupFile }
}
