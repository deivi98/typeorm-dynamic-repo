import { DataSource, EntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';

import { RepositoryInvalidArgumentException } from '../../../exceptions';
import {
  CommonQueryOptions,
  FilterType,
  OrderingBy,
} from '../query/query-options.interface';
import { CommonFindOptions, FindParams } from '../repository.interface';

export interface CommonSQLClauses {
  where?: FilterType[];
  ordering?: OrderingBy[];
}

/**
 * Complex function to map from query handler request params to Query Tree,
 * so that DynamicRepository can understand and build SQL query dynamically
 *
 * This is the magic bridge between DynamicRepository and the rest of the repo
 *
 * DO NOT TOUCH: please contact @deivi98 first
 *
 * @param dataSource TypeORM DataSource
 * @param table name of the database table for entity in this node
 * @param propertyPath name of the attribute at entity
 * @param findOptions DynamicRepository find options, repo can work differently depending on them
 * @param queryOptions Selections, filters, ordering...
 * @param exploredEntities param to remember what entities have been explored to prevent cycles
 */
function buildQueryTree(
  dataSource: DataSource,
  table: string,
  propertyPath: string,
  findOptions: CommonFindOptions = { onlyEager: true, allowRecursively: [] },
  queryOptions: CommonQueryOptions = {},
  exploredEntities: string[] = [],
): QueryTree {
  let { selections, where, ordering } = queryOptions;
  const { onlyEager = true, allowRecursively = [] } = findOptions;

  // Get TypeORM entity metadata for table
  const metadata: EntityMetadata = dataSource.getMetadata(table);

  // Mark table as explored to avoid recurrent or cyclical relations
  exploredEntities.push(metadata.tableName);

  // Tree node options and fields
  const clauses: CommonSQLClauses = {};
  const fields: QueryTree[] = [];

  // Auxiliary vars to build relation tree nodes recursively
  const relationsSelections: Record<string, string[]> = {};
  const relationTableNames: Record<string, string> = {};
  const relationsFilters: Record<string, FilterType[]> = {};
  const relationOrderBy: Record<string, OrderingBy[]> = {};

  // We need to extract and save the names of the tables of relations
  metadata.relations.forEach((relation) => {
    relationTableNames[relation.propertyPath] =
      relation.inverseEntityMetadata.tableName;
  });

  const tableFields = metadata.columns
    .filter(
      (columnMetadata: ColumnMetadata) =>
        !(columnMetadata.propertyName in relationTableNames),
    )
    .map((columnMetadata: ColumnMetadata) => columnMetadata.propertyName);

  let tableSelections: string[] = [];

  if (selections?.length) {
    // If selections are provided, we just select those

    if (selections.includes('*')) {
      selections = selections.filter((selection: string) => selection !== '*'); // Remove wildcards

      // Add all non-present table fields to selection
      tableFields.forEach((field: string) => {
        if (!selections?.includes(field)) {
          selections?.push(field);
        }
      });
    }

    selections.forEach((field) => {
      const join = field.split('.');
      if (join.length > 1) {
        // If selection has a dot '.' it means it is a relation
        // So add selection to map and save selection for relation tree node that is build later on
        const relation = join[0];
        const relationField = field.substring(
          field.indexOf('.') + 1,
          field.length,
        );

        // Check if selection exists
        if (!(relation in relationTableNames)) {
          throw new RepositoryInvalidArgumentException(
            `Relation '${relation}' does not exist in ${metadata.tableName} entity`,
          );
        }

        if (!(relation in relationsSelections)) {
          relationsSelections[relation] = [];
        }

        relationsSelections[relation].push(relationField);

        // If relation field is wildcard, then leave
        // relation selections empty (will select all attributes)
        // if (relationField !== '*') {
        //   relationsSelections[relation].push(relationField);
        // }
      } else {
        if (field in relationTableNames) {
          // If it is a relation with no specified selection or wildcard, we select it entirely (including its relations)
          relationsSelections[field] = [];
        } else {
          // If it is regular (this table level) selection, we add it to this table selections

          // Check if selection exists
          if (!tableFields.includes(field)) {
            throw new RepositoryInvalidArgumentException(
              `Field '${field}' does not exist in ${metadata.tableName} entity`,
            );
          }

          tableSelections.push(field);
        }
      }
    });
  } else {
    // If no selections are provided, we select all attributes AND relations

    // Select all attribute names that are NOT relations into this table selections
    tableSelections = tableFields;

    let relations: RelationMetadata[] = metadata.relations;
    if (onlyEager) {
      // ONLY SELECT BY DEFAULT EAGER RELATIONS (TRUE BY DEFAULT)
      relations = relations.filter(
        (relation: RelationMetadata) => relation.isEager,
      );
    }

    // Select all entity relations
    relations
      // ONLY IF relation entity has not been explored yet (joined yet) before
      // or IF it has explicit permission (this is useful for recurrent relations e.g. A -> B -> C -> B)
      .filter(
        (relation: RelationMetadata) =>
          !exploredEntities.includes(
            relation.inverseEntityMetadata.tableName,
          ) ||
          allowRecursively.includes(relation.inverseEntityMetadata.tableName),
      )
      .forEach((relation: RelationMetadata) => {
        relationsSelections[relation.propertyPath] = [];
      });
  }

  // If filters are provided, as it is done with selections
  // we need to differenciate which level / relation are they
  if (where) {
    // This table level filters
    const tableFilters: FilterType[] = [];

    where.forEach((filter) => {
      const field = filter.field;
      const join = field.split('.');
      if (join.length > 1) {
        // If it is relation filter, we map it and add it to our
        // map to process later
        const relation = join[0];
        const relationFilter: string = field.substring(
          field.indexOf('.') + 1,
          field.length,
        );

        // Check if selection exists
        if (!(relation in relationTableNames)) {
          throw new RepositoryInvalidArgumentException(
            `Relation '${relation}' does not exist in ${metadata.tableName} entity`,
          );
        }

        if (!relationsFilters[relation]) {
          relationsFilters[relation] = [];
        }

        relationsFilters[relation].push({
          field: relationFilter,
          operator: filter.operator,
          value: filter.value,
        });

        // If filter is not selected
        // if (!relationsSelections[relation]) {
        //   relationsSelections[relation] = [relationFilter];
        // } else if (!(relationFilter in relationsSelections[relation])) {
        //   relationsSelections[relation].push(relationFilter);
        // }
      } else {
        // If it is this table / entity filter level
        // we add it to the array

        // Check if filter exists
        if (!tableFields.includes(field)) {
          throw new RepositoryInvalidArgumentException(
            `Field '${field}' does not exist in ${metadata.tableName} entity`,
          );
        }

        if (!tableSelections.includes(field)) {
          tableSelections.push(field);
        }

        tableFilters.push(filter);
      }
    });

    // For each filter on this node level,
    // we map it into this node options
    clauses.where = tableFilters;
  }

  // If order options are provided, same process here
  if (ordering) {
    // This table level ordering
    const tableOrdering: OrderingBy[] = [];

    ordering.forEach((orderBy) => {
      const field = orderBy.field;
      const join = field.split('.');
      if (join.length > 1) {
        // If it is relation ordering, we map it and add it to our
        // map to process later
        const relation = join[0];
        const relationOrdering: string = field.substring(
          field.indexOf('.') + 1,
          field.length,
        );

        // Check if selection exists
        if (!(relation in relationTableNames)) {
          throw new RepositoryInvalidArgumentException(
            `Relation '${relation}' does not exist in ${metadata.tableName} entity`,
          );
        }

        if (!relationOrderBy[relation]) {
          relationOrderBy[relation] = [];
        }

        relationOrderBy[relation].push({
          field: relationOrdering,
          type: orderBy.type,
        });

        // if (!relationsSelections[relation]) {
        //   relationsSelections[relation] = [relationOrdering];
        // } else if (!(relationOrdering in relationsSelections[relation])) {
        //   relationsSelections[relation].push(relationOrdering);
        // }
      } else {
        // If it is this table / entity ordering level
        // we add it to the array

        // Check if filter exists
        if (!tableFields.includes(field)) {
          throw new RepositoryInvalidArgumentException(
            `Field '${field}' does not exist in ${metadata.tableName} entity`,
          );
        }

        if (!tableSelections.includes(field)) {
          tableSelections.push(field);
        }

        tableOrdering.push(orderBy);
      }
    });

    // For each ordering on this node level,
    // we map it into this node options
    clauses.ordering = tableOrdering;
  }

  // For every regular selection (just normal attribute),
  // we add it to this node field list as a simple child node
  tableSelections.forEach((tableSelection) => {
    fields.push(new QueryTree(tableSelection));
  });

  // For each relation selected or found on this entity
  Object.keys(relationsSelections).forEach((relation: string) => {
    // Retrieve selections stored previously
    let queryOptions: CommonQueryOptions = {
      selections: relationsSelections[relation],
    };

    // Retrieve orderBy options stored previously
    if (relationOrderBy[relation]) {
      queryOptions = { ...queryOptions, ordering: relationOrderBy[relation] };
    }

    // Retrieve filters stored previously
    if (relationsFilters[relation]) {
      queryOptions = { ...queryOptions, where: relationsFilters[relation] };
    }

    // Builds relation entity query tree node recursively
    // and adds it to fields list of this node
    fields.push(
      buildQueryTree(
        dataSource,
        relationTableNames[relation],
        relation,
        findOptions,
        queryOptions,
        exploredEntities,
      ),
    );
  });

  // Returns this node once every child node has been recursively built
  return new QueryTree(propertyPath, clauses, fields);
}

/**
 * QueryTree
 * Represents query with a tree, each node with its arguments and options.
 * Each node is related to its fields (childs)
 * If a field does not have childs, then it is a simple field (Int, String)
 */
export class QueryTree {
  public name: string; // Name of field
  public clauses: CommonSQLClauses; // Query options
  public fields: QueryTree[]; // Child fields

  constructor(
    name: string,
    clauses: CommonSQLClauses = {},
    fields: QueryTree[] = [],
  ) {
    this.name = name;
    this.clauses = clauses;
    this.fields = fields;
  }

  /**
   * Creates the tree
   * @param dataSource TypeORM data source
   * @param entityClass Entity to find (e.g. 'Order')
   * @param findOptions DynamicRepository find options, repo can work differently depending on them
   * @param queryOptions Selections, filters, ordering...
   * @returns a recursive query tree
   */
  public static createTree<T>(
    dataSource: DataSource,
    ...args: FindParams<T>
  ): QueryTree {
    const [entityClass, queryOptions, findOptions] = args;

    return buildQueryTree(
      dataSource,
      entityClass as string,
      entityClass as string,
      findOptions,
      queryOptions,
    );
  }

  /**
   * Sets the node child trees
   * @param fields childFields
   */
  public setFields(fields: QueryTree[]): void {
    this.fields = fields;
  }

  /**
   * Sets de node clauses
   * @param clauses field clauses
   */
  public setOptions(clauses: CommonSQLClauses): void {
    this.clauses = clauses;
  }

  /**
   * Returns a child field
   * @param name fieldName
   */
  public getField(name: string): any {
    return this.fields.find((field) => field.name === name);
  }

  /**
   * Check if this field is a relation
   */
  public isRelation(): boolean {
    if (this.fields?.length) {
      return true;
    }

    return false;
  }

  /**
   * Transforms the entire tree recursively into a printable object
   */
  public toObject(): Record<string, any> {
    const obj: any = {};

    if (Object.keys(this.clauses).length) {
      obj.__clauses = this.clauses;
    }

    this.fields.forEach((field) => {
      obj[field.name] = field.toObject();
    });

    return obj;
  }
}
