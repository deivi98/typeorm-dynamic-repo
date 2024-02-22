import {
  DataSource,
  EntityMetadata,
  EntitySchema,
  ObjectLiteral,
  ObjectType,
  SelectQueryBuilder,
} from 'typeorm';
import { RelationMetadata } from 'typeorm/metadata/RelationMetadata';

import { FilterOperator, OrderType } from '../query/query-options.interface';
import {
  CommonRepository,
  FindParams,
  PaginatedFindParams,
} from '../repository.interface';
import { QueryTree } from './query-tree';

// ALIAS STRATEGY USED TO SELECT & JOIN ATTRIBUTES AND TABLES
// e.g. order__articles__article_id
const ALIAS_STRATEGY: string = '__';

/**
 * Function to ensure no selections are repeated
 * @param selections already selected
 * @param newSelections new attributes
 */
function addSelections(selections: string[], newSelections: string[]): void {
  newSelections.forEach((newSel) => {
    if (!selections.includes(newSel)) {
      selections.push(newSel);
    }
  });
}

/**
 * Function to select all join attributes of relation
 * @param selections already selected attributes
 * @param relation relation to Join
 * @param alias entity alias
 * @param relationAlias related entity alias
 */
function selectJoinNeccessaryAttributes(
  selections: string[],
  relation: RelationMetadata,
  alias: string,
  relationAlias: string,
): void {
  const joinColumns: string[] = relation.joinColumns.map(
    (joinColumn) => alias + '.' + joinColumn.databaseName,
  );
  const inverseJoinColumns: string[] = relation.inverseJoinColumns.map(
    (joinColumn) => relationAlias + '.' + joinColumn.databaseName,
  );
  addSelections(selections, joinColumns);
  addSelections(selections, inverseJoinColumns);

  if (!relation.inverseRelation) {
    return;
  }

  const inverseRelationJoinColumns: string[] =
    relation.inverseRelation.joinColumns.map(
      (joinColumn) => relationAlias + '.' + joinColumn.databaseName,
    );
  const inverseRelationInverseJoinColumns: string[] =
    relation.inverseRelation.inverseJoinColumns.map(
      (joinColumn) => alias + '.' + joinColumn.databaseName,
    );
  addSelections(selections, inverseRelationJoinColumns);
  addSelections(selections, inverseRelationInverseJoinColumns);
}

/**
 * Function to select requested field attributes in request
 * @param selections already selected attributes
 * @param tree QueryTree
 * @param alias Entity alias
 */
function selectEntityQueryFields(
  selections: string[],
  tree: QueryTree,
  alias: string,
): void {
  // Firstly, we list all selected fields at this level of the query tree
  const selectedFields = tree.fields
    .filter((field) => !field.isRelation())
    .map((field) => alias + '.' + field.name);

  // We select all of above
  addSelections(selections, selectedFields);
}

/**
 * Function to add order by options to query
 * @param qb query builder
 * @param tree QueryTree
 * @param alias Entity alias
 */
function addOrderByOptions<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  tree: QueryTree,
  alias: string,
): void {
  // We add order options
  if (tree.clauses.ordering) {
    tree.clauses.ordering.forEach(({ field, type }) => {
      switch (type) {
        case OrderType.ASC:
          qb.addOrderBy(alias + '.' + field, 'ASC');
          break;
        case OrderType.DESC:
          qb.addOrderBy(alias + '.' + field, 'DESC');
          break;
        default:
          break;
      }
    });
  }
}

/**
 * Function to add where options to query
 * @param qb query builder
 * @param tree QueryTree
 * @param alias Entity alias
 */
function addWhereOptions<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  tree: QueryTree,
  alias: string,
): void {
  // We add where options if there are any
  if (tree.clauses.where) {
    tree.clauses.where.forEach(({ field, operator, value }) => {
      const placeholder: string = alias + ALIAS_STRATEGY + field;
      const sqlField: string = alias + '.' + field;

      switch (operator) {
        case FilterOperator.IN: {
          const listValues: string[] = value.replaceAll(' ', '').split(',');
          qb.andWhere(sqlField + ' IN (:...' + placeholder + ')', {
            [`${placeholder}`]: listValues,
          });
          break;
        }
        case FilterOperator.CONTAINS:
          qb.andWhere(sqlField + ' LIKE :' + placeholder, {
            [`${placeholder}`]: '%' + value + '%',
          });
          break;
        case FilterOperator.STARTS_WITH:
          qb.andWhere(sqlField + ' LIKE :' + placeholder, {
            [`${placeholder}`]: value + '%',
          });
          break;
        case FilterOperator.ENDS_WITH:
          qb.andWhere(sqlField + ' LIKE :' + placeholder, {
            [`${placeholder}`]: '%' + value,
          });
          break;
        case FilterOperator.LOWER:
          qb.andWhere(sqlField + ' < :' + placeholder, {
            [`${placeholder}`]: value,
          });
          break;
        case FilterOperator.LOWER_OR_EQUAL:
          qb.andWhere(sqlField + ' <= :' + placeholder, {
            [`${placeholder}`]: value,
          });
          break;
        case FilterOperator.GREATER:
          qb.andWhere(sqlField + ' > :' + placeholder, {
            [`${placeholder}`]: value,
          });
          break;
        case FilterOperator.GREATER_OR_EQUAL:
          qb.andWhere(sqlField + ' >= :' + placeholder, {
            [`${placeholder}`]: value,
          });
          break;
        case FilterOperator.NOT_EQUAL:
          qb.andWhere(sqlField + ' != :' + placeholder, {
            [`${placeholder}`]: value,
          });
          break;
        default: {
          qb.andWhere(sqlField + ' = :' + placeholder, {
            [`${placeholder}`]: value,
          });
          break;
        }
      }
    });
  }
}

/**
 * Builds TypeORM query with the query builder recursively,
 * joining every requested relation,
 * selection every asked attribute,
 * adding query options.
 * @param tree QueryTree
 * @param qb SelectQueryBuilder
 * @param alias Entity alias
 * @param metadata Entity metadata
 * @param selections All selections being done
 */
function buildQueryRecursively<T extends ObjectLiteral>(
  tree: QueryTree,
  qb: SelectQueryBuilder<T>,
  alias: string,
  metadata: EntityMetadata,
  selections: string[],
): void {
  selectEntityQueryFields(selections, tree, alias);
  addOrderByOptions(qb, tree, alias);
  addWhereOptions(qb, tree, alias);

  // For each relation of query
  tree.fields
    .filter((field) => field.isRelation())
    .forEach((relationTree) => {
      const relation = metadata.findRelationWithPropertyPath(relationTree.name);

      // If the relation query tree is asking for exists in entity, we join it recursively
      if (relation) {
        // const relationAlias =
        //   qb.connection.namingStrategy.eagerJoinRelationAlias(
        //     alias,
        //     relation.propertyPath,
        //   );
        const relationAlias = alias + ALIAS_STRATEGY + relation.propertyPath;
        selectJoinNeccessaryAttributes(
          selections,
          relation,
          alias,
          relationAlias,
        );
        qb.leftJoin(alias + '.' + relation.propertyPath, relationAlias);
        buildQueryRecursively(
          relationTree,
          qb,
          relationAlias,
          relation.inverseEntityMetadata,
          selections,
        );
      }
    });
}

/**
 * Generates TypeORM query builder based on QueryTree args, relations & options
 * @param dataSource TypeORM DataSource
 * @param tree QueryTree
 * @param entityClass Entity
 */
function generateQueryBuilder<T extends ObjectLiteral>(
  dataSource: DataSource,
  entityClass: ObjectType<T> | EntitySchema<T> | string,
  tree: QueryTree,
): SelectQueryBuilder<T> {
  const metadata = dataSource.getMetadata(entityClass);
  const qb = dataSource.createQueryBuilder<T>(entityClass, metadata.tableName);

  qb.select([]); // Clear any selected attributes in the query builder
  const selections: string[] = []; // Prepare array of selected attributes
  buildQueryRecursively<T>(tree, qb, qb.alias, metadata, selections);
  qb.select(selections); // Add selected attributes to select

  return qb;
}

/**
 * DYNAMIC REPOSITORY
 * This class helps to resolve any query based on a query tree
 * It can find any type of entity, join every requested relation and select asked attributes.
 *
 * FEATURES:
 * - Finds any given entity including all of its relations recursively by default
 * - If selections (attributes) are specified, only those will be returned
 * - If no selections (attributes) specified, all are selected by default
 * - It can receive all sorts of filters and options, regardless at what level of entity or relation
 * - It automatically handles recursive or cyclical relation dependencies
 *
 */
export class DynamicRepository implements CommonRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly debug: boolean,
  ) {}

  /**
   * Finds and counts multiple instances of entity
   * @param entityClass Entity to find (e.g. 'Order')
   * @param findOptions DynamicRepository find options, repo can work differently depending on them
   * @param queryOptions Selections, filters, ordering...
   * @param skip offset
   * @param take page size
   * @returns An array of T and its total excluding pagination
   */
  public async findAndCount<T extends ObjectLiteral>(
    ...args: PaginatedFindParams<T>
  ): Promise<[T[], number]> {
    const [entityClass, queryOptions, findOptions, skip, take] = args;

    if (!skip && !take) {
      // If there is no pagination, we can save one SQL query
      // as we can count results on our side
      const findResults = await this.find(...args);
      return [findResults, findResults.length];
    }

    const query: QueryTree = QueryTree.createTree(
      this.dataSource,
      entityClass,
      queryOptions,
      findOptions,
    );

    if (this.debug) {
      console.log('findAndCount query tree:');
      console.log(JSON.stringify(query.toObject(), null, 2));
    }

    const qb = generateQueryBuilder<T>(this.dataSource, entityClass, query);

    if (this.debug) {
      console.log('findAndCount SQL query:');
      console.log(qb.getSql());
      console.log(qb.getParameters());
    }

    const results: [T[], number] = await qb
      .skip(skip)
      .take(take)
      .getManyAndCount();

    if (this.debug) {
      console.log('findAndCount results:');
      console.log(results[0]);
    }

    return results;
  }

  /**
   * Finds multiple instances of entity
   * @param entityClass Entity to find (e.g. 'Order')
   * @param findOptions DynamicRepository find options, repo can work differently depending on them
   * @param queryOptions Selections, filters, ordering...
   * @param skip offset
   * @param take page size
   * @returns An array of T
   */
  public async find<T extends ObjectLiteral>(
    ...args: PaginatedFindParams<T>
  ): Promise<T[]> {
    const [entityClass, queryOptions, findOptions, skip, take] = args;

    const query: QueryTree = QueryTree.createTree(
      this.dataSource,
      entityClass,
      queryOptions,
      findOptions,
    );

    if (this.debug) {
      console.log('find query tree:');
      console.log(JSON.stringify(query.toObject(), null, 2));
    }

    const qb = generateQueryBuilder<T>(this.dataSource, entityClass, query);

    if (this.debug) {
      console.log('find SQL query:');
      console.log(qb.getSql());
      console.log(qb.getParameters());
    }

    const results: T[] = await qb.skip(skip).take(take).getMany();

    if (this.debug) {
      console.log('find results:');
      console.log(results[0]);
    }

    return results;
  }

  /**
   * Finds one instance of an entity
   * @param entityClass Entity to find (e.g. 'Order')
   * @param findOptions DynamicRepository find options, repo can work differently depending on them
   * @param queryOptions Selections, filters, ordering...
   * @returns entity
   */
  public async findOne<T extends ObjectLiteral>(
    ...args: FindParams<T>
  ): Promise<T | null> {
    const [entityClass] = args;

    const query: QueryTree = QueryTree.createTree(this.dataSource, ...args);

    if (this.debug) {
      console.log('findOne query tree:');
      console.log(JSON.stringify(query.toObject(), null, 2));
    }

    const qb = generateQueryBuilder<T>(this.dataSource, entityClass, query);

    if (this.debug) {
      console.log('findOne SQL query:');
      console.log(qb.getSql());
      console.log(qb.getParameters());
    }

    const result: T | null = await qb.getOne();

    if (this.debug) {
      console.log('findOne result:');
      console.log(result);
    }

    return result;
  }
}
