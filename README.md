# Medusa Smart Collections

Metadata-based smart product collections for Medusa v2.

This plugin adds a Smart Collection builder to product collection detail pages in the Medusa Admin. Merchants can define rule groups against product fields, and the plugin syncs matching products into the collection.

## Features

- Admin widget on product collection details.
- Condition builder with nested AND / OR groups.
- Rules for product `title`, `description`, and `handle`.
- Automatic sync when smart collection settings change.
- Product create/update subscriber to refresh matching smart collections.
- Metadata-based storage, so no database tables or migrations are required.

## Installation

Install the package:

```bash
pnpm add medusa-plugin-smart-collections
```

Register it in `medusa-config.ts`:

```ts
import { defineConfig } from "@medusajs/framework/utils";

export default defineConfig({
	// ...
	plugins: [
		{
			resolve: "medusa-plugin-smart-collections",
			options: {},
		},
	],
});
```

Restart Medusa and open a product collection detail page in the Admin. The Smart Collection widget is injected into `product_collection.details.after`.

## Development

For local plugin development:

```bash
pnpm install
pnpm build
pnpm medusa plugin:publish
```

In your Medusa app:

```bash
pnpm medusa plugin:add medusa-plugin-smart-collections
```

Then run the plugin watcher:

```bash
pnpm medusa plugin:develop
```

## Data Model

The plugin stores settings on product collection metadata:

```ts
{
  isSmartCollection: true,
  smartCollectionConditions: {
    expression: {
      kind: "group",
      operator: "all",
      children: [
        {
          kind: "rule",
          rule: {
            field: "title",
            operator: "starts_with",
            value: "The"
          }
        }
      ]
    }
  }
}
```

## Rule Operators

- `equals`
- `not_equals`
- `contains`
- `not_contains`
- `starts_with`
- `ends_with`

## Notes

- This package currently targets Medusa `^2.14`.
- No storefront API is added. Storefronts continue to consume normal Medusa product collections.
- Large catalogs may need queueing or batching adjustments for product update syncs.
