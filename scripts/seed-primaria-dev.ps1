param([ValidateSet('DryRun', 'Apply')][string]$Mode = 'DryRun')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'd1-helpers.ps1')
$connection = $null
$transaction = $null
$stage = 'preflight'
$committed = $false

function New-D1Command([string]$sql, [hashtable]$values = @{}) {
  $command = $connection.CreateCommand()
  $command.Transaction = $transaction
  $command.CommandText = $sql
  $command.CommandTimeout = 15
  foreach ($key in $values.Keys) { $null = $command.Parameters.AddWithValue('@' + $key, $values[$key]) }
  return $command
}
function Read-D1([string]$sql, [hashtable]$values = @{}) {
  $command = New-D1Command $sql $values
  try {
    $reader = $command.ExecuteReader()
    try { $table = [System.Data.DataTable]::new(); $table.Load($reader); return ,$table }
    finally { $reader.Dispose() }
  } finally { $command.Dispose() }
}
function Write-D1([string]$sql, [hashtable]$values) {
  if ($Mode -ne 'Apply') { throw 'Conflicto: una escritura fue solicitada en DryRun.' }
  $command = New-D1Command $sql $values
  try { return $command.ExecuteScalar() } finally { $command.Dispose() }
}
function Snapshot-D1 {
  $snapshot = @{}
  # Lista fija de tablas. Sus filas se comparan en memoria, sin imprimir hashes ni datos privados.
  foreach ($name in @('Usuario', 'Docente', 'Alumno', 'Curso', 'Matricula', 'Tarea', 'Entrega')) {
    $table = Read-D1 ("SELECT * FROM dbo.[$name] ORDER BY [Id$name];")
    $records = @{}
    foreach ($row in $table.Rows) {
      $record = [ordered]@{}
      foreach ($column in $table.Columns) { $record[$column.ColumnName] = $row[$column.ColumnName] }
      $records[[string]$row["Id$name"]] = ($record | ConvertTo-Json -Compress -Depth 4)
    }
    $snapshot[$name] = $records
  }
  return $snapshot
}
function Assert-Preserved($before, $after) {
  foreach ($name in $before.Keys) {
    foreach ($id in $before[$name].Keys) {
      if (-not $after[$name].ContainsKey($id) -or $before[$name][$id] -cne $after[$name][$id]) {
        throw ('Conflicto: se modificó un registro previo de ' + $name)
      }
    }
  }
  foreach ($name in @('Tarea', 'Entrega')) {
    if ($before[$name].Count -ne $after[$name].Count) { throw ('Conflicto: cambió el número de ' + $name) }
  }
}
function Invoke-PrivateHash($request) {
  $response = ($request | ConvertTo-Json -Compress -Depth 6) | & node (Join-Path $PSScriptRoot '../node_modules/ts-node/dist/bin.js') (Join-Path $PSScriptRoot 'd1-passwords.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Conflicto: falló el servicio de hashing privado.' }
  return ($response | ConvertFrom-Json)
}
function Save-PrivateJson([string]$path, $data) {
  # El directorio ya restringe la herencia antes de escribir cualquier secreto.
  $temporary = $path + '.pending'
  [IO.File]::WriteAllText($temporary, ($data | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
  Protect-D1Path $temporary $false
  [IO.File]::Move($temporary, $path, $true)
}

try {
  $guard = & node (Join-Path $PSScriptRoot '../node_modules/ts-node/dist/bin.js') (Join-Path $PSScriptRoot 'd1-passwords.ts') guard
  if ($LASTEXITCODE -ne 0 -or $guard -cne 'DEVELOPMENT_OK') { throw 'Conflicto: D1 solo se permite en development.' }
  if (-not $env:LOCALAPPDATA) { throw 'Conflicto: falta LOCALAPPDATA.' }
  $definition = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'primaria-4a.json') -Raw | ConvertFrom-Json
  if ($definition.scenario -cne 'PRIMARIA_4A_V1' -or $definition.accounts.Count -ne 11 -or
      @($definition.accounts | Where-Object rol -eq 'DOCENTE').Count -ne 1 -or $definition.courses.Count -ne 5) {
    throw 'Conflicto: definición de escenario inválida.'
  }
  $directory = Join-Path $env:LOCALAPPDATA 'GestorTareas\D1'
  $credentialsFile = Join-Path $directory 'PRIMARIA_4A_V1.credentials.json'
  $manifestFile = Join-Path $directory 'PRIMARIA_4A_V1.manifest.json'
  $credentials = @{}
  if (Test-Path -LiteralPath $credentialsFile) {
    Assert-D1PrivateAcl $credentialsFile
    $private = Get-Content -LiteralPath $credentialsFile -Raw | ConvertFrom-Json
    if ($private.scenario -cne $definition.scenario) { throw 'Conflicto: archivo privado de otro escenario.' }
    foreach ($account in $private.accounts) {
      if ($credentials.ContainsKey($account.correo) -or $account.correo -notin $definition.accounts.correo -or
          -not ($account.password -is [string]) -or $account.password.Length -lt 1 -or $account.password.Length -gt 256) {
        throw 'Conflicto: contenido incompatible en el archivo privado.'
      }
      $credentials[$account.correo] = $account
    }
  }

  $stage = 'destino'
  $connection = [System.Data.SqlClient.SqlConnection]::new(
    'Server=tcp:localhost,1433;Database=GestorTareasDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=5')
  $connection.Open()
  $target = Read-D1 @'
SELECT CONVERT(nvarchar(128),SERVERPROPERTY('MachineName')) machine,
       CONVERT(nvarchar(128),SERVERPROPERTY('InstanceName')) instance,
       DB_NAME() database_name, IS_SRVROLEMEMBER('sysadmin') admin;
'@
  Assert-D1Target $target.Rows[0]
  Write-Output 'DESTINO_CONFIRMADO=LizandroTanta/MSSQLSERVER03/GestorTareasDB ADMIN_WINDOWS=true'
  $transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
  $before = Snapshot-D1
  $stage = 'inspeccion'
  $ids = @{}
  $newAccounts = @()
  $newCourses = @()
  $newEnrollments = @()
  $verifyPasswords = @()
  $missingCredentials = @()
  foreach ($account in $definition.accounts) {
    $rows = Read-D1 @'
SELECT u.IdUsuario,u.Nombres,u.Apellidos,u.Correo,u.ContrasenaHash,u.Estado,
 CASE WHEN d.IdDocente IS NULL THEN 0 ELSE 1 END EsDocente,
 CASE WHEN a.IdAlumno IS NULL THEN 0 ELSE 1 END EsAlumno
FROM dbo.Usuario u LEFT JOIN dbo.Docente d ON d.IdDocente=u.IdUsuario
LEFT JOIN dbo.Alumno a ON a.IdAlumno=u.IdUsuario WHERE u.Correo=@correo;
'@ @{ correo = [string]$account.correo }
    if ($rows.Rows.Count -gt 1) { throw ('Conflicto: correo duplicado ' + $account.correo) }
    if ($rows.Rows.Count -eq 0) { $newAccounts += $account; continue }
    $row = $rows.Rows[0]
    Assert-D1Account $account $row
    $ids[$account.correo] = [int]$row.IdUsuario
    if ($credentials.ContainsKey($account.correo)) {
      $verifyPasswords += @{ correo=$account.correo; password=$credentials[$account.correo].password; hash=[string]$row.ContrasenaHash }
    } else { $missingCredentials += $account.correo }
  }
  if ($verifyPasswords.Count -gt 0) {
    $verified = Invoke-PrivateHash @{mode='verify'; accounts=$verifyPasswords}
    foreach ($result in $verified.accounts) {
      if (-not $result.valid) { throw ('Conflicto: credencial local no coincide con la cuenta ' + $result.correo) }
    }
  }
  $teacher = @($definition.accounts | Where-Object rol -eq 'DOCENTE')[0]
  foreach ($course in $definition.courses) {
    $rows = Read-D1 'SELECT IdCurso,Nombre,Codigo,IdDocente,Estado FROM dbo.Curso WHERE Codigo=@codigo;' @{codigo=[string]$course.codigo}
    if ($rows.Rows.Count -gt 1) { throw ('Conflicto: código duplicado ' + $course.codigo) }
    if ($rows.Rows.Count -eq 0) { $newCourses += $course; continue }
    Assert-D1Course $course $rows.Rows[0] $ids[$teacher.correo]
    $ids[$course.codigo] = [int]$rows.Rows[0].IdCurso
  }
  if ($ids.ContainsKey($teacher.correo)) {
    $owned = Read-D1 'SELECT Codigo FROM dbo.Curso WHERE IdDocente=@id AND Estado=1;' @{id=$ids[$teacher.correo]}
    foreach ($row in $owned.Rows) {
      if ($row.Codigo -notin $definition.courses.codigo) { throw 'Conflicto: el docente tiene cursos activos ajenos al escenario.' }
    }
  }
  $students = @($definition.accounts | Where-Object rol -eq 'ALUMNO')
  foreach ($student in $students) {
    if ($ids.ContainsKey($student.correo)) {
      $active = Read-D1 'SELECT c.Codigo FROM dbo.Matricula m JOIN dbo.Curso c ON c.IdCurso=m.IdCurso WHERE m.IdAlumno=@id AND m.Estado=@estado AND c.Estado=1;' @{id=$ids[$student.correo];estado='ACTIVA'}
      foreach ($row in $active.Rows) {
        if ($row.Codigo -notin $definition.courses.codigo) { throw ('Conflicto: cursos activos ajenos para ' + $student.correo) }
      }
    }
    foreach ($course in $definition.courses) {
      $rows = Read-D1 'SELECT IdMatricula,Estado FROM dbo.Matricula WHERE IdAlumno=@alumno AND IdCurso=@curso;' @{alumno=[int]$ids[$student.correo];curso=[int]$ids[$course.codigo]}
      if ($rows.Rows.Count -gt 1) { throw 'Conflicto: matrícula duplicada.' }
      if ($rows.Rows.Count -eq 1) { Assert-D1Enrollment $rows.Rows[0] ($student.reference + '/' + $course.codigo) }
      else { $newEnrollments += @{alumno=$student.correo;curso=$course.codigo} }
    }
  }
  foreach ($course in $definition.courses) {
    if ($ids.ContainsKey($course.codigo)) {
      $members = Read-D1 'SELECT u.Correo FROM dbo.Matricula m JOIN dbo.Usuario u ON u.IdUsuario=m.IdAlumno WHERE m.IdCurso=@id;' @{id=$ids[$course.codigo]}
      foreach ($row in $members.Rows) {
        if ($row.Correo -notin $students.correo) { throw ('Conflicto: matrícula de otro alumno en ' + $course.codigo) }
      }
    }
  }
  Write-Output ("PLAN usuarios_nuevos=$($newAccounts.Count) usuarios_reutilizados=$(11-$newAccounts.Count) cursos_nuevos=$($newCourses.Count) cursos_reutilizados=$(5-$newCourses.Count) matriculas_nuevas=$($newEnrollments.Count) matriculas_reutilizadas=$(50-$newEnrollments.Count)")
  foreach ($mail in $missingCredentials) { Write-Output ('LIMITACION credencial local ausente: ' + $mail + '; no se cambia su contraseña.') }
  if ($Mode -eq 'DryRun') {
    Assert-Preserved $before (Snapshot-D1)
    $transaction.Rollback(); $transaction.Dispose(); $transaction=$null
    Write-Output 'DRY_RUN_OK=true ESCRITURAS_SQL=0 ESCRITURAS_ARCHIVOS=0'
    exit 0
  }

  $stage = 'credenciales'
  if (-not (Test-Path -LiteralPath $directory)) { $null=New-Item -ItemType Directory -Path $directory -Force }
  Protect-D1Path $directory $true
  $hashes = @{}
  if ($newAccounts.Count -gt 0) {
    $requests = @($newAccounts | ForEach-Object {
      if ($credentials.ContainsKey($_.correo)) { @{correo=$_.correo;password=$credentials[$_.correo].password} }
      else { @{correo=$_.correo} }
    })
    $generated = Invoke-PrivateHash @{mode='create';accounts=$requests}
    foreach ($entry in $generated.accounts) {
      $hashes[$entry.correo]=$entry.hash
      $credentials[$entry.correo]=[pscustomobject]@{correo=$entry.correo;password=$entry.password}
    }
    $all = @($credentials.Values)
    if (@($all.password | Sort-Object -Unique).Count -ne $all.Count) { throw 'Conflicto: las contraseñas no son distintas.' }
    # Guardar antes del commit permite recuperar las credenciales incluso tras una interrupción.
    Save-PrivateJson $credentialsFile @{scenario=$definition.scenario;accounts=@($all | Sort-Object correo)}
    Assert-D1PrivateAcl $credentialsFile
  }

  $stage = 'inserciones'
  foreach ($account in $newAccounts) {
    $id = [int](Write-D1 @'
INSERT INTO dbo.Usuario (Nombres,Apellidos,Correo,ContrasenaHash,Estado)
OUTPUT INSERTED.IdUsuario VALUES (@nombres,@apellidos,@correo,@hash,1);
'@ @{nombres=[string]$account.nombres;apellidos=[string]$account.apellidos;correo=[string]$account.correo;hash=[string]$hashes[$account.correo]})
    if ($account.rol -eq 'DOCENTE') { $null=Write-D1 'INSERT INTO dbo.Docente (IdDocente) VALUES (@id);' @{id=$id} }
    else { $null=Write-D1 'INSERT INTO dbo.Alumno (IdAlumno) VALUES (@id);' @{id=$id} }
    $ids[$account.correo]=$id
  }
  foreach ($course in $newCourses) {
    $ids[$course.codigo]=[int](Write-D1 'INSERT INTO dbo.Curso (Nombre,Codigo,IdDocente,Estado) OUTPUT INSERTED.IdCurso VALUES (@nombre,@codigo,@docente,1);' @{nombre=[string]$course.nombre;codigo=[string]$course.codigo;docente=$ids[$teacher.correo]})
  }
  foreach ($entry in $newEnrollments) {
    $null=Write-D1 'INSERT INTO dbo.Matricula (IdCurso,IdAlumno,FechaMatricula,Estado) OUTPUT INSERTED.IdMatricula VALUES (@curso,@alumno,SYSUTCDATETIME(),@estado);' @{curso=$ids[$entry.curso];alumno=$ids[$entry.alumno];estado='ACTIVA'}
  }

  $stage = 'verificacion SQL'
  $actualAccounts=@()
  foreach($account in $definition.accounts) {
    $rows=Read-D1 'SELECT u.IdUsuario,u.Nombres,u.Apellidos,u.Correo,u.Estado,CASE WHEN d.IdDocente IS NULL THEN 0 ELSE 1 END EsDocente,CASE WHEN a.IdAlumno IS NULL THEN 0 ELSE 1 END EsAlumno FROM dbo.Usuario u LEFT JOIN dbo.Docente d ON d.IdDocente=u.IdUsuario LEFT JOIN dbo.Alumno a ON a.IdAlumno=u.IdUsuario WHERE u.Correo=@correo;' @{correo=[string]$account.correo}
    if($rows.Rows.Count -ne 1){throw 'Conflicto: conteo final de cuenta.'}
    Assert-D1Account $account $rows.Rows[0]
    $actualAccounts += @{reference=$account.reference;correo=$account.correo;nombres=$account.nombres;apellidos=$account.apellidos;rol=$account.rol;idUsuario=[int]$rows.Rows[0].IdUsuario}
  }
  $actualCourses=@(); $actualEnrollments=@()
  foreach($course in $definition.courses){
    $rows=Read-D1 'SELECT IdCurso,Nombre,Codigo,IdDocente,Estado FROM dbo.Curso WHERE Codigo=@codigo;' @{codigo=[string]$course.codigo}
    if($rows.Rows.Count -ne 1){throw 'Conflicto: conteo final de curso.'}
    Assert-D1Course $course $rows.Rows[0] $ids[$teacher.correo]
    $actualCourses += @{codigo=$course.codigo;nombre=$course.nombre;idCurso=[int]$rows.Rows[0].IdCurso;idDocente=[int]$rows.Rows[0].IdDocente}
    $members=Read-D1 'SELECT IdMatricula,IdAlumno,IdCurso,Estado FROM dbo.Matricula WHERE IdCurso=@id;' @{id=$ids[$course.codigo]}
    if($members.Rows.Count -ne 10){throw 'Conflicto: el curso no tiene exactamente 10 matrículas.'}
    foreach($row in $members.Rows){
      Assert-D1Enrollment $row $course.codigo
      if([int]$row.IdAlumno -notin @($students | ForEach-Object {$ids[$_.correo]})){throw 'Conflicto: alumno ajeno.'}
      $actualEnrollments += @{idMatricula=[int]$row.IdMatricula;idAlumno=[int]$row.IdAlumno;idCurso=[int]$row.IdCurso;estado=[string]$row.Estado}
    }
  }
  foreach($student in $students){
    if(@($actualEnrollments | Where-Object idAlumno -eq $ids[$student.correo]).Count -ne 5){throw 'Conflicto: alumno sin cinco matrículas.'}
  }
  $after=Snapshot-D1
  Assert-Preserved $before $after
  $totals=[ordered]@{}; foreach($name in @('Usuario','Docente','Alumno','Curso','Matricula','Tarea','Entrega')){$totals[$name]=$after[$name].Count}
  $taskCount=0; $deliveryCount=0
  foreach($course in $actualCourses){
    $rows=Read-D1 'SELECT (SELECT COUNT(*) FROM dbo.Tarea WHERE IdCurso=@id) tareas,(SELECT COUNT(*) FROM dbo.Entrega e JOIN dbo.Tarea t ON t.IdTarea=e.IdTarea WHERE t.IdCurso=@id) entregas;' @{id=$course.idCurso}
    $taskCount += [int]$rows.Rows[0].tareas; $deliveryCount += [int]$rows.Rows[0].entregas
  }
  $transaction.Commit(); $committed=$true; $transaction.Dispose(); $transaction=$null
  $stage='manifiesto posterior al commit'
  $now=[DateTime]::UtcNow.ToString('o'); $firstRun=$now
  if(Test-Path -LiteralPath $manifestFile){$previous=Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json; $firstRun=$previous.createdAt}
  Save-PrivateJson $manifestFile @{scenario=$definition.scenario;target=$definition.target;createdAt=$firstRun;verifiedAt=$now;accounts=$actualAccounts;courses=$actualCourses;enrollments=$actualEnrollments;missingCredentials=$missingCredentials}
  Write-Output 'APPLY_OK=true TRANSACCION_COMMIT=true REGISTROS_PREVIOS_INTACTOS=true'
  Write-Output ("ESCENARIO usuarios=11 docentes=1 alumnos=10 cursos_activos=5 matriculas_ACTIVA=50 perfiles_invalidos=0 tareas=$taskCount entregas=$deliveryCount")
  Write-Output ('TOTALES_BASE=' + ($totals | ConvertTo-Json -Compress))
  Write-Output ('CREDENCIALES_PRIVADAS=' + $credentialsFile)
  Write-Output ('MANIFIESTO_SIN_SECRETOS=' + $manifestFile)
} catch {
  if($transaction){try{$transaction.Rollback()}catch{Write-Output 'No se pudo confirmar el rollback.'}}
  $message=[string]$_.Exception.Message
  if($message.StartsWith('Conflicto:') -or $message.StartsWith('Conflicto ')){Write-Output $message}
  Write-Output ("D1_FALLO etapa=$stage commit_realizado=$committed; sin imprimir detalles SQL ni secretos.")
  exit 1
} finally {
  if($transaction){$transaction.Dispose()}
  if($connection){$connection.Dispose()}
}
