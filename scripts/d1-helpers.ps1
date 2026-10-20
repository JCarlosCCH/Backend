function Assert-D1Target($row) {
  if ([string]$row.machine -ine 'LizandroTanta' -or [string]$row.instance -ine 'MSSQLSERVER03' -or
      [string]$row.database_name -cne 'GestorTareasDB' -or [int]$row.admin -ne 1) {
    throw 'Conflicto: el destino no es LizandroTanta/MSSQLSERVER03/GestorTareasDB con administrador local.'
  }
}

function Assert-D1Account($expected, $row) {
  if ([string]$row.Nombres -cne $expected.nombres -or [string]$row.Apellidos -cne $expected.apellidos -or
      [string]$row.Correo -cne $expected.correo -or -not [bool]$row.Estado -or
      ([int]$row.EsDocente -eq 1) -ne ($expected.rol -eq 'DOCENTE') -or
      ([int]$row.EsAlumno -eq 1) -ne ($expected.rol -eq 'ALUMNO')) {
    throw ('Conflicto de identidad, perfil o estado: ' + $expected.correo)
  }
}

function Assert-D1Course($expected, $row, [int]$teacherId) {
  if ([string]$row.Nombre -cne $expected.nombre -or [string]$row.Codigo -cne $expected.codigo -or
      -not [bool]$row.Estado -or [int]$row.IdDocente -ne $teacherId) {
    throw ('Conflicto de curso, docente o estado: ' + $expected.codigo)
  }
}

function Assert-D1Enrollment($row, [string]$reference) {
  if ([string]$row.Estado -cne 'ACTIVA') { throw ('Conflicto: matrícula no ACTIVA: ' + $reference) }
}

function Protect-D1Path([string]$path, [bool]$directory) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $path
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -gt 0 -and @($rules | Where-Object { $_.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18') }).Count -eq 0) { return }
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]))) { $acl.RemoveAccessRuleSpecific($rule) }
  foreach ($identity in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $rule = if ($directory) {
      [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    } else { [Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow') }
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}

function Assert-D1PrivateAcl([string]$path) {
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = Get-Acl -LiteralPath $path
  $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
  if (@($rules | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -notin @($sid, 'S-1-5-18') }).Count -gt 0) {
    throw 'Conflicto: el archivo de credenciales no tiene acceso restringido al usuario local y SYSTEM.'
  }
}
