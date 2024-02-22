# Dynamic Repository Module

## Querying entities

### Functions
There are three main functions:
- `findOne` - Retrieves one single entity instance
- `find` - Retrieves many entity instances (has pagination)
- `findAndCount` - Retrieves many entity instances and DB total (has pagination)

### Parameters
```ts
export type PaginatedFindParams<T> = [
  entityClass: ObjectType<T> | EntitySchema<T> | string, // E.g. 'OrderEntity'
  queryOptions?: CommonQueryOptions, // Look details below
  findOptions?: CommonFindOptions, // Look details below
  skip?: number, // Pagination offset
  take?: number, // Pagination limit
]
```

### Query options
```ts
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
```

### Find options
```ts
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
```

### Examples
This example retrieve all order attributes, + joins article including all its
attributes, + joins order meta and all its attributes
```ts
const orderEntities: [OrderEntity[], number] =
  await this.dynamicRepository.findAndCount<OrderEntity>(
    OrderEntity,
    {
      selections: [
        "*",
        "articles.*",
        "meta.*"
      ]
      where: [
        {
          field: 'shopperId',
          operator: FilterOperator.EQUAL,
          value: shopperId,
        },
      ],
      ordering: [
        {
          field: 'articles.id',
          type: OrderType.ASC,
        }
      ]
    },
    // This is needed because of special cyclical relation at fulfillment service
    // (Order -> Article -> Replacement -> Article again)
    // Check info on FindOptions above for better understanding
    { allowRecursively: ['article'] }, 
  );

...
```

This example retrieves the entire shopper entity, including
all of its attributes, relations, attributes of its relations,
relation of its relations... recursively

```ts
const shopperEntities: [ShopperEntity[], number] =
  await this.dynamicRepository.findOne<ShopperEntity>(
    ShopperEntity,
    {
      selections: [] // You can also get rid of this
      where: [
        {
          field: 'id',
          operator: FilterOperator.EQUAL,
          value: shopperId,
        },
      ],
      ordering: [] // You can also get rid of this
    },
  );
  
...
```

## NOTES

> [!CAUTION]
> Please note that **entity property names (e.g. articles.id, shopperId)** need to be specified, not db or response field names (e.g. article_id, order_shopper_id, shopper_Id)
