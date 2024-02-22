export enum OrderType {
  ASC = 'asc',
  DESC = 'desc',
}

export enum FilterOperator {
  IN = 'in',
  CONTAINS = 'contains',
  STARTS_WITH = 'startsWith',
  ENDS_WITH = 'endsWith',
  LOWER = '<',
  LOWER_OR_EQUAL = '<=',
  GREATER = '>',
  GREATER_OR_EQUAL = '>=',
  EQUAL = '=',
  NOT_EQUAL = '!=',
}

export interface FilterType {
  value: string;
  operator: FilterOperator;
  field: string;
}

export interface OrderingBy {
  field: string;
  type: OrderType;
}

/**
 * Options used to query, filter and order
 * entities attributes
 */
export interface CommonQueryOptions {
  /**
   * If empty, will select all entity attributes AND relations recursively
   * If present, will only select those. Same applies recursively:
   *
   * Let's say you have entity Order (id, name, ... , articles) which has relation
   * with Article (id, name, price, replacement, ...). Order has many Article/s. Also each
   * Article can also have a Replacement (id, name, ...)
   *
   * Wildcard (*) will select all regular attributes, EXCLUDING entity relations
   *
   * Some examples:
   * [] -> Will select all Order AND Article AND Replacement attributes
   * ['id', 'name'] -> Will only select Order id and name
   * ['*'] -> Will select all Order attributes, excluding relations
   * ['*', 'articles.*'] -> Will select all Order attributes and also join all Article attributes, EXCLUDING Article relations
   * ['*', 'articles'] -> Will select all Order attributes and also join all Article attributes, INCLUDING Article relations
   * ['*', 'articles.id', 'articles.replacement.*'] -> Will select all Order attributes, just Article id, and all article's Replacement attributes (excluding replacement relations)
   * ...
   */
  selections?: string[];
  /**
   * If empty, no where clauses will be used
   * If present, will filter by them. It can filter at any relation level.
   *
   * Some examples:
   * [ { field: 'id', operator: FilterOperator.EQUAL, value: 'exampleId' } ]
   * [ { field: 'articles.id', operator: FilterOperator.EQUAL, value: 'exampleId' } ]
   */
  where?: FilterType[];
  /**
   * If empty, no ordering clauses will be used
   * If present, will sort by them. It can sort at any relation level.
   *
   * Some examples:
   * [ { field: 'id', type: OrderType.ASC } ]
   * [ { field: 'articles.id', type: OrderType.DESC } ]
   */
  ordering?: OrderingBy[];
}
