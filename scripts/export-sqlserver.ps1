param([string]$Server = 'tcp:localhost,1433')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data
$exportDirectory = Join-Path $env:LOCALAPPDATA 'GestorTareas\Render'
[IO.Directory]::CreateDirectory($exportDirectory) | Out-Null
$exportPath = Join-Path $exportDirectory 'sqlserver-export.json'
$tables = @('Usuario','Docente','Alumno','Curso','Matricula','Tarea','Entrega')
$connection = New-Object System.Data.SqlClient.SqlConnection("Server=$Server;Database=GestorTareasDB;Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=5;Application Name=RenderExport")
$transaction = $null
try {
  $connection.Open()
  $transaction = $connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)
  $command = $connection.CreateCommand()
  $command.Transaction = $transaction
  $command.CommandTimeout = 15
  $command.CommandText = 'SELECT DB_NAME()'
  if ($command.ExecuteScalar() -ne 'GestorTareasDB') { throw 'Base de origen incorrecta' }
  $export = [ordered]@{version=1; database='GestorTareasDB'; tables=[ordered]@{}}
  foreach ($table in $tables) {
    $command.CommandText = "SELECT * FROM dbo.[$table] ORDER BY 1"
    $reader = $command.ExecuteReader()
    $rows = @()
    while ($reader.Read()) {
      $row = [ordered]@{}
      for ($column=0; $column -lt $reader.FieldCount; $column++) {
        $value = $reader.GetValue($column)
        if ($value -is [DBNull]) { $value = $null }
        elseif ($value -is [DateTime]) { $value = [DateTime]::SpecifyKind($value,[DateTimeKind]::Utc).ToString('o') }
        $row[$reader.GetName($column)] = $value
      }
      $rows += [PSCustomObject]$row
    }
    $reader.Close()
    $export.tables[$table] = @($rows)
    Write-Output "$table=$($rows.Count)"
  }
  $transaction.Commit()
  [IO.File]::WriteAllText($exportPath, ($export | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  # La copia contiene hashes. Restringirla al usuario actual y SYSTEM.
  $acl = Get-Acl -LiteralPath $exportPath
  $acl.SetAccessRuleProtection($true,$false)
  foreach ($rule in @($acl.Access)) { [void]$acl.RemoveAccessRuleSpecific($rule) }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow')))
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
  Set-Acl -LiteralPath $exportPath -AclObject $acl
  Write-Output 'Exportacion privada completada en %LOCALAPPDATA%\GestorTareas\Render\sqlserver-export.json'
} catch {
  if ($transaction) { try { $transaction.Rollback() } catch {} }
  throw
} finally { $connection.Dispose() }
