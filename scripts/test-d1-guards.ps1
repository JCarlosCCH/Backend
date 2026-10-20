$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'd1-helpers.ps1')
$checks=0
function Expect-Rejected([scriptblock]$operation) {
  $rejected=$false
  try { & $operation } catch { $rejected=$true }
  if(-not $rejected){throw 'Un conflicto no fue rechazado.'}
  $script:checks++
}
$target=@{machine='LizandroTanta';instance='MSSQLSERVER03';database_name='GestorTareasDB';admin=1}
Assert-D1Target $target; $checks++
foreach($field in @('machine','instance','database_name','admin')){
  $wrong=$target.Clone(); $wrong[$field]=if($field -eq 'admin'){0}else{'otro'}
  Expect-Rejected { Assert-D1Target $wrong }
}
$expected=@{nombres='Camila Valentina';apellidos='Soto Ramírez';correo='p4a.alumno01@example.test';rol='ALUMNO'}
$account=@{Nombres=$expected.nombres;Apellidos=$expected.apellidos;Correo=$expected.correo;Estado=$true;EsAlumno=1;EsDocente=0}
Assert-D1Account $expected $account; $checks++
foreach($field in @('Nombres','Apellidos','Estado','EsAlumno','EsDocente')){
  $wrong=$account.Clone()
  $wrong[$field]=switch($field){'Estado'{$false};'EsAlumno'{0};'EsDocente'{1};default{'otro'}}
  Expect-Rejected { Assert-D1Account $expected $wrong }
}
$course=@{codigo='PRU4A-MAT';nombre='Matemática - 4.º A Primaria (prueba)'}
$row=@{Codigo=$course.codigo;Nombre=$course.nombre;Estado=$true;IdDocente=41}
Assert-D1Course $course $row 41; $checks++
Expect-Rejected { Assert-D1Course $course $row 42 }
Expect-Rejected { Assert-D1Enrollment @{Estado='RETIRADA'} 'A01/PRU4A-MAT' }
Assert-D1Enrollment @{Estado='ACTIVA'} 'A01/PRU4A-MAT'; $checks++
$definition=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'primaria-4a.json') -Raw | ConvertFrom-Json
if(@($definition.accounts.correo | Sort-Object -Unique).Count -ne 11 -or
   @($definition.accounts | Where-Object rol -eq 'ALUMNO').Count -ne 10 -or
   @($definition.courses.codigo | Sort-Object -Unique).Count -ne 5 -or
   $definition.accounts[1].apellidos -cne 'Soto Ramírez' -or
   $definition.accounts[6].nombres -cne 'Sebastián Adrián') {throw 'Definición o Unicode alterados.'}
$checks++
$prior=$env:NODE_ENV
try {
  $env:NODE_ENV='production'
  $null=& node (Join-Path $PSScriptRoot '../node_modules/ts-node/dist/bin.js') (Join-Path $PSScriptRoot 'd1-passwords.ts') guard 2>&1
  if($LASTEXITCODE -eq 0){throw 'Producción no fue bloqueada.'}
  $checks++
} finally { $env:NODE_ENV=$prior }
Write-Output ("D1_GUARDS_OK casos=$checks SQL_EJECUTADO=false")
