import { EntitySchema, ObjectLiteral, ObjectType } from 'typeorm';

import { CommonQueryOptions } from './query/query-options.interface';

/**
 * These options tell DynamicRepository how to behave internally
 */
export interface CommonFindOptions {
  /**
   * Add entity table names here if you want repository to ignore cyclical relation restrictions [dangerous]
   * This is specially useful for cyclical relations. E.g. Order -> Article -> Replacement -> Article
   * If we allow ['article'] repository will go for 3 level join. However it will not join 'Replacement' again since it is not allowed to repeat
   */
  allowRecursively?: string[];
  /**
   * If true (default), dynamic repository will only select eager relations. Disable this option if you
   * want to join every relation regardless it is eager or not [not recommended]
   */
  onlyEager?: boolean;
}

export type FindParams<T> = [
  entityClass: ObjectType<T> | EntitySchema<T> | string,
  queryOptions?: CommonQueryOptions,
  findOptions?: CommonFindOptions,
];

export type PaginatedFindParams<T> = [
  ...args: FindParams<T>,
  skip?: number,
  take?: number,
];

export interface CommonRepository {
  find: <T extends ObjectLiteral>(
    ...args: PaginatedFindParams<T>
  ) => Promise<T[]>;
  findAndCount: <T extends ObjectLiteral>(
    ...args: PaginatedFindParams<T>
  ) => Promise<[T[], number]>;
  findOne: <T extends ObjectLiteral>(
    ...args: FindParams<T>
  ) => Promise<T | null>;
}
