# Gestor de Tareas — backend del núcleo

API académica para la I. E. Rey Josías: DOCENTE publica tareas en sus cursos, ALUMNO con matrícula ACTIVA entrega un PDF, el docente lo revisa y el alumno consulta su nota.

Para la demo con PostgreSQL en Render, consulte [RENDER-POSTGRES.md](../database/RENDER-POSTGRES.md).
SQL Server local continúa siendo el motor predeterminado. La importación a Render es manual.

## Requisitos y preparación

- Entorno comprobado: Windows, Node.js 24.15.0, npm 11.12.1, NestJS 10.4.22, TypeScript 5.9.3, TypeORM 0.3.31, `mssql` 12.7.2, Argon2 0.45.1, Jest 29.7.0 y Supertest 7.3.0. Node.js 20.17 o posterior es el requisito del proyecto.
- SQL Server local `LizandroTanta\MSSQLSERVER03`, base `GestorTareasDB`, cuenta técnica `gestor_tareas_app`. La API solo usa esa cuenta.

Desde `Backend/`:

```powershell
npm ci
Copy-Item .env.example .env  # solo si todavía no existe
npm run db:check
```

Complete en `.env` `DB_HOST`, `DB_USER`, `DB_PASSWORD`, uno entre `DB_PORT` y `DB_INSTANCE`, y un `JWT_SECRET` aleatorio de al menos 32 bytes. `JWT_EXPIRES_IN=1800`. En la instalación comprobada se usa host `localhost` y puerto SQL `1433`; `PORT=5000` es HTTP y es distinto de `DB_PORT`. `DB_TRUST_SERVER_CERTIFICATE=true` se admite solo en desarrollo local si el certificado SQL no se puede verificar. `.env` está fuera de Git.

El código mapea `Usuario`, `Docente`, `Alumno`, `Curso`, `Matricula`, `Tarea` y `Entrega` conforme a `database/GestorTareasDB.sql`; Docente y Alumno comparten su PK con Usuario. TypeORM mantiene `synchronize: false`, `dropSchema: false` y `migrationsRun: false`. El arranque no ejecuta DDL, migraciones ni semillas. La cuenta técnica tiene SELECT sobre las siete tablas, INSERT solo sobre Tarea y Entrega, y UPDATE solo de `Nota`, `ObservacionDocente` y `Estado` en Entrega. No tiene DELETE ni permisos generales. Consulte `database/ACCESO_SQL_SERVER.md`.

## Datos ficticios de desarrollo

Preparación y carga **manual**, transaccional e idempotente, sin tareas precargadas:

```powershell
npm run auth:prepare-dev
npm run auth:seed-dev
npm run core:prepare-dev
npm run core:seed-dev
```

Los comandos preparan cuentas ficticias con hashes Argon2id, dos cursos y matrículas activas y retirada. Las credenciales de consulta quedan fuera del repositorio en `%LOCALAPPDATA%\GestorTareas\A1\auth-dev-credentials.json` y `core-dev-credentials.json`. No copie esos archivos al frontend ni al repositorio. Las semillas no cambian contraseñas existentes. `npm run auth:rotate-dev` permite cambiar manualmente las tres claves A1.

### D1: aula sintética PRIMARIA_4A_V1

El escenario de 4.º de primaria, sección A, contiene 1 docente, 10 alumnos, 5 cursos y 50 matrículas ACTIVA, persistidos en SQL Server. Sus nombres y asignaciones son ficticios; no representan datos oficiales ni una propuesta curricular de la I. E. Rey Josías. Conserva los registros de etapas anteriores.

Desde `Backend/`, con PowerShell 7, Node y las dependencias existentes instaladas:

```powershell
npm run d1:inspect  # solo lectura: destino, coincidencias y conflictos
npm run d1:apply    # carga explícita, transaccional; reutiliza registros coincidentes
npm run d1:test     # 17 comprobaciones de guardas, sin SQL
npm run d1:verify   # API ya iniciada en 5000; SQL y HTTP reales, solo lecturas y login
```

La carga exige `NODE_ENV=development`, autenticación integrada de Windows con el administrador local autorizado y confirma por consulta `LizandroTanta/MSSQLSERVER03/GestorTareasDB` antes de escribir. Utiliza `tcp:localhost,1433`; no cambia la configuración SQL de la API ni sus permisos. Un conflicto de identidad, perfil, propietario, estado o contraseña local detiene la transacción sin corregirlo silenciosamente. No carga tareas, entregas ni notas. Ninguno de estos comandos se ejecuta al arrancar la aplicación.

Credenciales privadas: `%LOCALAPPDATA%\GestorTareas\D1\PRIMARIA_4A_V1.credentials.json`, restringido al usuario local y SYSTEM, fuera del repositorio y del build. Manifiesto con IDs y fechas, sin contraseñas: `PRIMARIA_4A_V1.manifest.json` en el mismo directorio. Cada cuenta nueva recibe una contraseña diferente procesada por `PasswordHasherService`. Repetir la carga conserva el archivo y las contraseñas. Si falta una credencial de una cuenta existente, se informa y no se restablece.

El verificador inicia las 11 sesiones secuencialmente con 13 segundos entre intentos; respeta el limitador existente. Comprueba los cinco cursos exactos por identidad y los nombres contra SQL usando una entrega anterior en modo lectura. [Resultados, archivos y guía manual de D1](../database/D1-PRIMARIA_4A_V1.md).

## Arranque y pruebas

```powershell
npm run start:dev
npm run build
npm run lint
npm run test:unit
npm run test:e2e
```

API: `http://localhost:5000/api`. Swagger `/docs` y `/docs-json` solo en desarrollo. Jest usa dobles de repositorios y archivos; `db:check` y las llamadas a la API local comprueban SQL Server real por separado. Con backend, frontend en `127.0.0.1:5173` y datos preparados, `node scripts/verify-core-http.js C:\ruta\trabajo.pdf` ejecuta manualmente un recorrido por el proxy usando un PDF válido. Si se omite la ruta, busca `%TEMP%\gestor-tareas-core-piloto.pdf`. Crea una tarea y una entrega nuevas; no se ejecuta con Jest ni al arrancar. La comprobación visual requiere recorrer las páginas del frontend en un navegador.

El recorrido imprime los ID creados. Con ellos se pueden ejecutar `node scripts/check-core-access.js <idTarea> <idEntrega>` y `node scripts/check-core-db.js <idTarea> <idEntrega> C:\ruta\trabajo.pdf`. Para comprobar persistencia tras reiniciar **una instancia propia** en el puerto 5001, inicie desde `Backend/` `$env:PORT='5001'; npm run start:prod`, ejecute en otra terminal `node scripts/check-persisted-core.js <idTarea> <idEntrega>`, detenga esa instancia con Ctrl+C, repita el arranque y la consulta. No cierre procesos ajenos.

## Rutas existentes

Todas llevan `/api`:

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/health` | API atendiendo solicitudes |
| GET | `/health/database` | Consulta SQL real |
| POST | `/auth/login` | Sesión JWT de cuenta habilitada |
| GET | `/auth/me` | Identidad y perfil vigentes |
| GET | `/cursos` | Cursos propios o con matrícula activa |
| GET | `/cursos/:id/tareas` | Tareas accesibles; oculta borradores al alumno |
| POST | `/cursos/:id/tareas` | Publicación del docente responsable; referencia PDF opcional |
| GET | `/tareas/:id` | Detalle accesible |
| GET | `/tareas/:id/archivo` | Descarga autorizada de referencia |
| POST | `/tareas/:id/entregas` | PDF del alumno antes del límite |
| GET | `/tareas/:id/mi-entrega` | Entrega y nota propias, o `null` |
| GET | `/tareas/:id/entregas` | Lista para docente responsable |
| GET | `/entregas/:id/archivo` | Descarga autorizada de entrega |
| PATCH | `/entregas/:id/calificacion` | Nota y observación del docente responsable |

Desde D1, el listado autorizado de entregas añade `nombresAlumno` y `apellidosAlumno` a los campos existentes. Se obtienen por `Entrega → Alumno → Usuario`, seleccionando solo los datos necesarios en una consulta con relaciones. Se mantiene la comprobación previa del docente y su curso. No se incorporan credenciales ni un listado público de alumnos.

La publicación y entrega usan `multipart/form-data`. Se admite PDF no vacío de hasta 10 MiB, una entrega por alumno y tarea y una referencia opcional. El directorio `Backend/storage/` es privado y se ignora en Git. Son límites técnicos del piloto, no políticas institucionales confirmadas. La inspección básica de firma y final PDF no demuestra ausencia de malware. Las descargas exigen autorización y se fuerzan como adjunto.

La nota admite 0–20 con hasta dos decimales y observación de hasta 500 caracteres. Es la escala del prototipo, no una política institucional confirmada. `null` significa pendiente; `0` es válido. La tarea nueva queda `PUBLICADA`, la entrega nueva `ENTREGADA` y al calificar pasa a `REVISADA`.

Las fechas de entrada son ISO 8601 con `Z`. El formulario convierte la hora local seleccionada a UTC. SQL `DATETIME2` se interpreta como **UTC sin zona**; el servidor escribe objetos `Date` y serializa respuestas UTC con `Z`. React muestra las fechas en la zona del navegador. La hora de entrega del servidor debe ser estrictamente anterior al límite.

## Límites pendientes

El token vive en memoria del frontend; cerrar sesión no revoca un JWT emitido, que vence tras 1800 segundos. El login limita intentos por IP. El almacenamiento local y la comprobación PDF son propios del piloto; faltan revisión antimalware, almacenamiento compartido y despliegue institucional. No hay administración web, CRUD destructivo ni funciones ajenas al flujo principal.

La auditoría de dependencias actual no pudo consultar el registro npm (`ECONNRESET`); el estado pendiente se registra en [dependency-audit-core.md](dependency-audit-core.md). No se aplicaron cambios forzados.
