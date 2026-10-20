$ErrorActionPreference = 'Stop'
$stage = 'preflight'
$connection = $null
$transaction = $null

try {
  $privateFile = Join-Path $env:LOCALAPPDATA 'GestorTareas\A1\auth-dev-credentials.json'
  if (-not (Test-Path -LiteralPath $privateFile)) { throw 'missing private file' }
  $accounts = (Get-Content -LiteralPath $privateFile -Raw | ConvertFrom-Json).accounts
  $expected = @(
    @{ correo = 'docente.a1@example.test'; rol = 'DOCENTE'; estado = $true },
    @{ correo = 'alumno.a1@example.test'; rol = 'ALUMNO'; estado = $true },
    @{ correo = 'alumno.inactivo.a1@example.test'; rol = 'ALUMNO'; estado = $false }
  )
  if ($accounts.Count -ne 3) { throw 'account count mismatch' }
  for ($index = 0; $index -lt 3; $index++) {
    if ($accounts[$index].correo -ne $expected[$index].correo -or
        $accounts[$index].rol -ne $expected[$index].rol -or
        [bool]$accounts[$index].estado -ne $expected[$index].estado -or
        -not ([string]$accounts[$index].hash).StartsWith('$argon2id$v=19$m=19456,p=1,t=2$')) {
      throw 'private file mismatch'
    }
  }

  $connection = [System.Data.SqlClient.SqlConnection]::new(
    'Server=tcp:localhost,1433;Database=GestorTareasDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=5'
  )
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandText = @'
SELECT CONVERT(nvarchar(128), SERVERPROPERTY('MachineName')) AS machine,
       CONVERT(nvarchar(128), SERVERPROPERTY('InstanceName')) AS instance,
       DB_NAME() AS database_name, IS_SRVROLEMEMBER('sysadmin') AS admin,
       (SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID('dbo')
          AND name IN ('Usuario', 'Docente', 'Alumno')) AS tables;
'@
  $reader = $command.ExecuteReader()
  $null = $reader.Read()
  $valid = [string]$reader['machine'] -eq $env:COMPUTERNAME -and
    [string]$reader['instance'] -eq 'MSSQLSERVER03' -and
    [string]$reader['database_name'] -eq 'GestorTareasDB' -and
    [int]$reader['admin'] -eq 1 -and [int]$reader['tables'] -eq 3
  $reader.Close()
  if (-not $valid) { throw 'destination mismatch' }

  $stage = 'transaction'
  $transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
  $results = @()
  foreach ($account in $accounts) {
    $stage = 'account:' + $account.correo
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
    if ($exists) {
      $id = [int]$reader['IdUsuario']
      $docente = [int]$reader['EsDocente'] -eq 1
      $alumno = [int]$reader['EsAlumno'] -eq 1
      $matches = [string]$reader['Nombres'] -ceq [string]$account.nombres -and
        [string]$reader['Apellidos'] -ceq [string]$account.apellidos -and
        [string]$reader['ContrasenaHash'] -ceq [string]$account.hash -and
        [bool]$reader['Estado'] -eq [bool]$account.estado -and
        $docente -eq ($account.rol -eq 'DOCENTE') -and
        $alumno -eq ($account.rol -eq 'ALUMNO')
      $reader.Close()
      if (-not $matches) { throw 'account conflict' }
      $results += [pscustomobject]@{ correo = $account.correo; idUsuario = $id; rol = $account.rol; resultado = 'reutilizada' }
      continue
    }
    $reader.Close()

    $command = $connection.CreateCommand()
    $command.Transaction = $transaction
    $command.CommandText = @'
INSERT INTO dbo.Usuario (Nombres, Apellidos, Correo, ContrasenaHash, Estado)
OUTPUT INSERTED.IdUsuario
VALUES (@nombres, @apellidos, @correo, @hash, @estado);
'@
    foreach ($item in @(@('nombres', 80), @('apellidos', 80), @('correo', 150), @('hash', 255))) {
      $parameter = $command.Parameters.Add('@' + $item[0], [System.Data.SqlDbType]::NVarChar, [int]$item[1])
      $parameter.Value = [string]$account.($item[0])
    }
    $parameter = $command.Parameters.Add('@estado', [System.Data.SqlDbType]::Bit)
    $parameter.Value = [bool]$account.estado
    $id = [int]$command.ExecuteScalar()
    $command = $connection.CreateCommand()
    $command.Transaction = $transaction
    if ($account.rol -eq 'DOCENTE') {
      $command.CommandText = 'INSERT INTO dbo.Docente (IdDocente) VALUES (@id);'
    } else {
      $command.CommandText = 'INSERT INTO dbo.Alumno (IdAlumno) VALUES (@id);'
    }
    $parameter = $command.Parameters.Add('@id', [System.Data.SqlDbType]::Int)
    $parameter.Value = $id
    $null = $command.ExecuteNonQuery()
    $results += [pscustomobject]@{ correo = $account.correo; idUsuario = $id; rol = $account.rol; resultado = 'creada' }
  }
  $transaction.Commit()
  $transaction = $null
  $results | ConvertTo-Json -Compress
  'TRANSACTION_COMMITTED=true'
} catch {
  if ($transaction) { try { $transaction.Rollback() } catch {} }
  'FAILED_STAGE=' + $stage
  exit 1
} finally {
  if ($connection) { $connection.Dispose() }
}
