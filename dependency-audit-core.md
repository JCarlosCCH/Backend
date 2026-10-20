# Estado de revisión de dependencias del backend

El 23/09/2026 se ejecutó `npm audit --json` desde `Backend/`. Terminó con código 1 porque la solicitud al registro npm falló con `ECONNRESET`. No se recibió un reporte de vulnerabilidades; el conteo actual del backend queda pendiente. Las dependencias no se cambiaron ni se aplicaron actualizaciones forzadas.

Antes de un despliegue se debe repetir la auditoría con el registro disponible y revisar los avisos que afecten el manejo de JWT, PDF, multipart y SQL Server. La auditoría previa del frontend se conserva en `Frontend/dependency-audit-a1.md`.
