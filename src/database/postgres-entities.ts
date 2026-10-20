import { EntitySchema, EntitySchemaColumnOptions, EntitySchemaRelationOptions, getMetadataArgsStorage } from 'typeorm';
import { ColumnType } from 'typeorm/driver/types/ColumnTypes';

// Conserva las clases y relaciones usadas por los repositorios; adapta solo el mapeo
// de PostgreSQL sin cambiar los decoradores de la instalación SQL Server existente.
export function createPostgresEntities(entities: readonly (new () => object)[]): EntitySchema[] {
  const metadata = getMetadataArgsStorage();
  return entities.map((entity) => {
    const table = metadata.tables.find((item) => item.target === entity);
    if (!table) throw new Error('Entidad sin mapeo de tabla');
    const columns: Record<string, EntitySchemaColumnOptions> = {};
    for (const column of metadata.columns.filter((item) => item.target === entity)) {
      const { length, ...original } = column.options;
      let type = original.type;
      if (type === 'nvarchar') type = length === 'MAX' ? 'text' : 'varchar';
      if (type === 'bit') type = 'boolean';
      if (type === 'datetime2') type = 'timestamptz';
      const options = { ...original, type: type as ColumnType } as EntitySchemaColumnOptions;
      if (length !== undefined && length !== 'MAX') options.length = length;
      if (typeof original.default === 'function' && original.default() === 'SYSDATETIME()') {
        options.default = () => 'CURRENT_TIMESTAMP';
      }
      const generation = metadata.generations.find((item) => item.target === entity && item.propertyName === column.propertyName);
      if (generation) {
        if (generation.strategy !== 'increment') throw new Error('Generación de ID no soportada');
        options.generated = 'increment';
      }
      columns[column.propertyName] = options;
    }
    const relations: Record<string, EntitySchemaRelationOptions> = {};
    for (const relation of metadata.relations.filter((item) => item.target === entity)) {
      const join = metadata.joinColumns.find((item) => item.target === entity && item.propertyName === relation.propertyName);
      relations[relation.propertyName] = {
        ...relation.options,
        target: typeof relation.type === 'function' ? (relation.type as () => { name: string })().name : relation.type,
        type: relation.relationType,
        ...(join ? { joinColumn: { name: join.name, referencedColumnName: join.referencedColumnName, foreignKeyConstraintName: join.foreignKeyConstraintName } } : {}),
      };
    }
    const uniques = metadata.uniques.filter((item) => item.target === entity).map((item) => {
      if (!Array.isArray(item.columns)) throw new Error('Restricción única no soportada');
      return { name: item.name, columns: item.columns };
    });
    return new EntitySchema({ name: entity.name, target: entity, tableName: table.name, schema: 'dbo', columns, relations, uniques });
  });
}
