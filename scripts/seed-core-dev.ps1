$ErrorActionPreference = 'Stop'
$stage = 'preflight'
$connection = $null
$transaction = $null

function New-DbCommand([string]$sql, [hashtable]$values) {
  $command = $connection.CreateCommand()
  $command.Transaction = $transaction
  $command.CommandText = $sql
  foreach ($key in $values.Keys) { $null = $command.Parameters.AddWithValue('@' + $key, $values[$key]) }
  return $command
}

try {
  $privateFile = Join-Path $env:LOCALAPPDATA 'GestorTareas\A1\core-dev-credentials.json'
  if (-not (Test-Path -LiteralPath $privateFile)) { throw 'private file missing' }
  $accounts = @((Get-Content -LiteralPath $privateFile -Raw | ConvertFrom-Json).accounts)
  $expected = @(
    @{ correo = 'docente.core@example.test'; rol = 'DOCENTE'; estado = $true },
    @{ correo = 'alumno.ajeno.core@example.test'; rol = 'ALUMNO'; estado = $true }
  )
  if ($accounts.Count -ne 2) { throw 'account count mismatch' }
  for ($index = 0; $index -lt 2; $index++) {
    if ($accounts[$index].correo -ne $expected[$index].correo -or
        $accounts[$index].rol -ne $expected[$index].rol -or
        [bool]$accounts[$index].estado -ne $true -or
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
SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) AS machine,
       CONVERT(nvarchar(128),SERVERPROPERTY('InstanceName')) AS instance,
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
  $ids = @{}
  foreach ($item in @(
    @{ correo = 'docente.a1@example.test'; rol = 'DOCENTE' },
    @{ correo = 'alumno.a1@example.test'; rol = 'ALUMNO' }
  )) {
    $command = New-DbCommand @'
SELECT u.IdUsuario,u.Estado,
       CASE WHEN d.IdDocente IS NULL THEN 0 ELSE 1 END AS EsDocente,
       CASE WHEN a.IdAlumno IS NULL THEN 0 ELSE 1 END AS EsAlumno
FROM dbo.Usuario u WITH (UPDLOCK,HOLDLOCK)
LEFT JOIN dbo.Docente d ON d.IdDocente=u.IdUsuario
LEFT JOIN dbo.Alumno a ON a.IdAlumno=u.IdUsuario
WHERE u.Correo=@correo;
'@ @{ correo = $item.correo }
    $reader = $command.ExecuteReader()
    $found = $reader.Read()
    if (-not $found) { $reader.Close(); throw 'A1 account missing' }
    $id = [int]$reader['IdUsuario']
    $matches = [bool]$reader['Estado'] -and
      ([int]$reader['EsDocente'] -eq 1) -eq ($item.rol -eq 'DOCENTE') -and
      ([int]$reader['EsAlumno'] -eq 1) -eq ($item.rol -eq 'ALUMNO')
    $reader.Close()
    if (-not $matches) { throw 'A1 account conflict' }
    $ids[$item.correo] = $id
  }

  foreach ($account in $accounts) {
    $stage = 'account:' + $account.correo
    $command = New-DbCommand @'
SELECT u.IdUsuario,u.Nombres,u.Apellidos,u.ContrasenaHash,u.Estado,
       CASE WHEN d.IdDocente IS NULL THEN 0 ELSE 1 END AS EsDocente,
       CASE WHEN a.IdAlumno IS NULL THEN 0 ELSE 1 END AS EsAlumno
FROM dbo.Usuario u WITH (UPDLOCK,HOLDLOCK)
LEFT JOIN dbo.Docente d ON d.IdDocente=u.IdUsuario
LEFT JOIN dbo.Alumno a ON a.IdAlumno=u.IdUsuario
WHERE u.Correo=@correo;
'@ @{ correo = [string]$account.correo }
    $reader = $command.ExecuteReader()
    $found = $reader.Read()
    if ($found) {
      $id = [int]$reader['IdUsuario']
      $matches = [string]$reader['Nombres'] -ceq [string]$account.nombres -and
        [string]$reader['Apellidos'] -ceq [string]$account.apellidos -and
        [string]$reader['ContrasenaHash'] -ceq [string]$account.hash -and
        [bool]$reader['Estado'] -and
        ([int]$reader['EsDocente'] -eq 1) -eq ($account.rol -eq 'DOCENTE') -and
        ([int]$reader['EsAlumno'] -eq 1) -eq ($account.rol -eq 'ALUMNO')
      $reader.Close()
      if (-not $matches) { throw 'account conflict' }
    } else {
      $reader.Close()
      $command = New-DbCommand @'
INSERT INTO dbo.Usuario (Nombres,Apellidos,Correo,ContrasenaHash,Estado)
OUTPUT INSERTED.IdUsuario VALUES (@nombres,@apellidos,@correo,@hash,1);
'@ @{ nombres = [string]$account.nombres; apellidos = [string]$account.apellidos; correo = [string]$account.correo; hash = [string]$account.hash }
      $id = [int]$command.ExecuteScalar()
      $profileTable = if ($account.rol -eq 'DOCENTE') { 'dbo.Docente' } else { 'dbo.Alumno' }
      $profileColumn = if ($account.rol -eq 'DOCENTE') { 'IdDocente' } else { 'IdAlumno' }
      $command = New-DbCommand "INSERT INTO $profileTable ($profileColumn) VALUES (@id);" @{ id = $id }
      $null = $command.ExecuteNonQuery()
    }
    $ids[[string]$account.correo] = $id
  }

  $courses = @(
    @{ codigo = 'CORE-MAT-3A'; nombre = 'Matemática 3.° A'; docente = 'docente.a1@example.test' },
    @{ codigo = 'CORE-COM-3B'; nombre = 'Comunicación 3.° B'; docente = 'docente.core@example.test' }
  )
  foreach ($course in $courses) {
    $stage = 'course:' + $course.codigo
    $command = New-DbCommand 'SELECT IdCurso,Nombre,IdDocente,Estado FROM dbo.Curso WITH (UPDLOCK,HOLDLOCK) WHERE Codigo=@codigo;' @{ codigo = $course.codigo }
    $reader = $command.ExecuteReader()
    $found = $reader.Read()
    if ($found) {
      $id = [int]$reader['IdCurso']
      $matches = [string]$reader['Nombre'] -ceq $course.nombre -and
        [int]$reader['IdDocente'] -eq $ids[$course.docente] -and [bool]$reader['Estado']
      $reader.Close()
      if (-not $matches) { throw 'course conflict' }
    } else {
      $reader.Close()
      $command = New-DbCommand @'
INSERT INTO dbo.Curso (Nombre,Codigo,IdDocente,Estado)
OUTPUT INSERTED.IdCurso VALUES (@nombre,@codigo,@docente,1);
'@ @{ nombre = $course.nombre; codigo = $course.codigo; docente = $ids[$course.docente] }
      $id = [int]$command.ExecuteScalar()
    }
    $ids[$course.codigo] = $id
  }

  foreach ($enrollment in @(
    @{ curso = 'CORE-MAT-3A'; alumno = 'alumno.a1@example.test'; estado = 'ACTIVA' },
    @{ curso = 'CORE-MAT-3A'; alumno = 'alumno.ajeno.core@example.test'; estado = 'RETIRADA' },
    @{ curso = 'CORE-COM-3B'; alumno = 'alumno.ajeno.core@example.test'; estado = 'ACTIVA' }
  )) {
    $stage = 'enrollment:' + $enrollment.curso + ':' + $enrollment.alumno
    $command = New-DbCommand 'SELECT Estado FROM dbo.Matricula WITH (UPDLOCK,HOLDLOCK) WHERE IdCurso=@curso AND IdAlumno=@alumno;' @{ curso = $ids[$enrollment.curso]; alumno = $ids[$enrollment.alumno] }
    $existing = $command.ExecuteScalar()
    if ($null -ne $existing) {
      if ([string]$existing -cne $enrollment.estado) { throw 'enrollment conflict' }
    } else {
      $command = New-DbCommand @'
INSERT INTO dbo.Matricula (IdCurso,IdAlumno,FechaMatricula,Estado)
VALUES (@curso,@alumno,SYSUTCDATETIME(),@estado);
'@ @{ curso = $ids[$enrollment.curso]; alumno = $ids[$enrollment.alumno]; estado = $enrollment.estado }
      $null = $command.ExecuteNonQuery()
    }
  }

  $transaction.Commit()
  $transaction = $null
  'CORE_SEED_COMMITTED=true ACCOUNTS=2 COURSES=2 ENROLLMENTS=3 TASKS_CREATED=0'
} catch {
  if ($transaction) { try { $transaction.Rollback() } catch {} }
  'FAILED_STAGE=' + $stage
  exit 1
} finally {
  if ($connection) { $connection.Dispose() }
}
